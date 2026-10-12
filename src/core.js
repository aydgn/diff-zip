import { resolve } from "node:path";
import { executeCommand, codedError } from "./utils.js";
import { checkGitInstalled, checkGitRepo, resolveCommit, parseNameStatus, getTreeEntries } from "./gitUtils.js";
import { archiveCommittedFiles, buildZipName } from "./archiverUtils.js";

export const createDiffZip = async ({ base, target, cwd = process.cwd(), outDir = cwd, date = new Date(), signal }) => {
  signal?.throwIfAborted();
  const outputDirectory = resolve(outDir);
  await checkGitInstalled(undefined, signal);
  const root = await checkGitRepo(cwd, signal);
  const baseCommit = await resolveCommit(base, root, signal);
  const targetCommit = await resolveCommit(target, root, signal);
  let diff;
  let tree;
  try {
    const output = await executeCommand("git", ["--no-replace-objects", "diff", "--name-status", "-z", "--no-renames", "--ignore-submodules=none", baseCommit, targetCommit, "--"], { cwd: root, encoding: null, signal });
    signal?.throwIfAborted();
    diff = parseNameStatus(output);
    tree = await getTreeEntries(targetCommit, root, signal);
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause.name === "AbortError" || cause.code === "INVALID_DIFF") throw cause;
    throw codedError("INVALID_DIFF", "Could not read the committed tree difference.", cause);
  }
  signal?.throwIfAborted();
  const archived = [];
  const skipped = [];
  for (const path of diff.changed) {
    const entry = tree.get(path);
    if (!entry) throw codedError("INVALID_DIFF", `Changed path is missing from Target: ${JSON.stringify(path)}`);
    if (entry.mode === "160000") {
      skipped.push({ path, reason: "submodule" });
    } else {
      archived.push(path);
    }
  }
  const zipPath = archived.length ? await archiveCommittedFiles({
    commit: targetCommit,
    paths: archived,
    cwd: root,
    outDir: outputDirectory,
    name: buildZipName(base, target, date),
    signal,
  }) : null;
  return { zipPath, archived, deleted: diff.deleted, skipped };
};
