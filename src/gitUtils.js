import { executeCommand, codedError } from "./utils.js";
import { TextDecoder } from "node:util";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decodePaths = output => {
  try {
    return utf8.decode(output);
  } catch (cause) {
    throw codedError("INVALID_DIFF", "Git returned invalid UTF-8 path data.", cause);
  }
};

export const checkGitInstalled = async (cwd, signal) => {
  signal?.throwIfAborted();
  try {
    return await executeCommand("git", ["--version"], { cwd, signal });
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause.name === "AbortError") throw cause;
    throw codedError("GIT_NOT_FOUND", "Git is not available.", cause);
  }
};

export const checkGitRepo = async (cwd, signal) => {
  signal?.throwIfAborted();
  try {
    const root = await executeCommand("git", ["rev-parse", "--show-toplevel"], { cwd, signal });
    return root.replace(/\n$/, "");
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause.name === "AbortError") throw cause;
    throw codedError("NOT_A_REPO", "The current directory is not a Git working repository.", cause);
  }
};

export const parseBranches = output => {
  const local = [];
  const remote = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [ref, name, symref] = line.split("\t");
    if (!name || symref) continue;
    if (ref.startsWith("refs/heads/")) local.push({ name, ref });
    else if (ref.startsWith("refs/remotes/")) remote.push({ name, ref });
  }
  return { local, remote };
};

export const getBranches = async cwd => {
  const output = await executeCommand("git", [
    "for-each-ref", "--sort=refname", "--format=%(refname)%09%(refname:short)%09%(symref)",
    "refs/heads/", "refs/remotes/",
  ], { cwd });
  let current = null;
  try {
    current = (await executeCommand("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd })).replace(/\r?\n$/, "");
  } catch (error) {
    if (error.exitCode !== 1) throw error;
  }
  return { ...parseBranches(output), current };
};

export const resolveCommit = async (ref, cwd, signal) => {
  signal?.throwIfAborted();
  if (typeof ref !== "string" || !ref || ref.includes("\0")) {
    throw codedError("BAD_REF", "A valid Base and Target reference is required.");
  }
  try {
    return (await executeCommand("git", ["--no-replace-objects", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd, signal })).trim();
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause.name === "AbortError") throw cause;
    throw codedError("BAD_REF", `Cannot resolve reference ${JSON.stringify(ref)} to a commit.`, cause);
  }
};

export const parseNameStatus = output => {
  const invalid = () => codedError("INVALID_DIFF", "Git returned malformed or unsupported name-status data.");
  if (!Buffer.isBuffer(output)) throw invalid();
  const changed = [];
  const deleted = [];
  if (!output.length) return { changed, deleted };
  if (output[output.length - 1] !== 0) throw invalid();
  const tokens = decodePaths(output).split("\0");
  tokens.pop();
  const pathAt = index => {
    const path = tokens[index];
    if (!path) throw invalid();
    return path;
  };
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[AMTD]$/.test(status)) {
      const path = pathAt(index++);
      (status === "D" ? deleted : changed).push(path);
    } else if (/^[RC]\d{1,3}$/.test(status) && Number(status.slice(1)) <= 100) {
      const oldPath = pathAt(index++);
      const newPath = pathAt(index++);
      if (status[0] === "R") deleted.push(oldPath);
      changed.push(newPath);
    } else {
      throw invalid();
    }
  }
  return { changed, deleted };
};

export const getTreeEntries = async (commit, cwd, signal) => {
  signal?.throwIfAborted();
  const output = await executeCommand("git", ["--no-replace-objects", "ls-tree", "-rz", "--full-tree", commit], { cwd, encoding: null, signal });
  signal?.throwIfAborted();
  const entries = new Map();
  for (const record of decodePaths(output).split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const header = record.slice(0, tab).split(" ");
    if (tab < 0 || header.length !== 3) throw codedError("INVALID_DIFF", "Git returned malformed tree data.");
    entries.set(record.slice(tab + 1), { mode: header[0], type: header[1] });
  }
  return entries;
};
