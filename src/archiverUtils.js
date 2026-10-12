import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { executeCommand, codedError } from "./utils.js";

export const buildZipName = (base, target, date) => {
  const name = ref => ref.replace(/^refs\/(?:heads|remotes)\//, "").replace(/[\/\\]/g, "_");
  const pad = value => String(value).padStart(2, "0");
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const basename = `${name(base)}-to-${name(target)}-${timestamp}.zip`;
  if (Buffer.byteLength(basename, "utf8") <= 255) return basename;
  const digest = createHash("sha256").update(base).update("\0").update(target).digest("hex").slice(0, 16);
  return `diff-${digest}-${timestamp}.zip`;
};

const archiveEntries = bytes => {
  const invalid = () => codedError("ARCHIVE_MISMATCH", "Git produced an invalid ZIP directory.");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw invalid();
  let count = bytes.readUInt16LE(end + 10);
  let directory = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || directory === 0xffffffff) {
    if (end < 20 || bytes.readUInt32LE(end - 20) !== 0x07064b50) throw invalid();
    const zip64 = Number(bytes.readBigUInt64LE(end - 12));
    if (!Number.isSafeInteger(zip64) || zip64 + 56 > bytes.length || bytes.readUInt32LE(zip64) !== 0x06064b50) throw invalid();
    count = Number(bytes.readBigUInt64LE(zip64 + 32));
    directory = Number(bytes.readBigUInt64LE(zip64 + 48));
  }
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(directory)) throw invalid();
  const files = [];
  for (let index = 0; index < count; index++) {
    if (directory + 46 > end || bytes.readUInt32LE(directory) !== 0x02014b50) throw invalid();
    const length = bytes.readUInt16LE(directory + 28);
    const next = directory + 46 + length + bytes.readUInt16LE(directory + 30) + bytes.readUInt16LE(directory + 32);
    if (next > end) throw invalid();
    const path = bytes.toString("utf8", directory + 46, directory + 46 + length);
    if (!path.endsWith("/")) files.push(path);
    directory = next;
  }
  return files;
};

export const archiveCommittedFiles = async ({ commit, paths, cwd, outDir, name, signal }) => {
  signal?.throwIfAborted();
  const zipPath = join(outDir, name);
  let temporary;
  try {
    let bytes;
    try {
      temporary = await mkdtemp(join(outDir, ".diff-zip-"));
      signal?.throwIfAborted();
      const repository = join(temporary, "repository.git");
      const objects = await executeCommand("git", ["rev-parse", "--path-format=absolute", "--git-path", "objects"], { cwd, signal });
      const format = await executeCommand("git", ["rev-parse", "--show-object-format"], { cwd, signal });
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
      env.GIT_CONFIG_NOSYSTEM = "1";
      env.GIT_CONFIG_GLOBAL = devNull;
      env.GIT_ATTR_NOSYSTEM = "1";
      await executeCommand("git", ["init", "--bare", "--template=", `--object-format=${format.trim()}`, repository], { cwd: temporary, env, signal });
      signal?.throwIfAborted();
      await mkdir(join(repository, "info"), { recursive: true });
      signal?.throwIfAborted();
      // Keep committed export-ignore, but archive original blobs without $Format$ substitutions.
      await writeFile(join(repository, "info", "attributes"), "* -export-subst\n", { flag: "wx", signal });
      signal?.throwIfAborted();
      env.GIT_ALTERNATE_OBJECT_DIRECTORIES = JSON.stringify(objects.replace(/\r?\n$/, ""));
      // Only objects are shared: source config, index, worktree and info attributes are isolated.
      bytes = await executeCommand("git", ["--git-dir", repository, "-c", `core.attributesFile=${devNull}`, "--literal-pathspecs", "archive", "--format=zip", "-9", commit, "--", ...paths], { cwd: temporary, env, encoding: null, signal });
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      throw codedError("ARCHIVE_FAILED", "Could not archive the Target commit.", cause);
    }
    signal?.throwIfAborted();
    const expected = new Set(paths);
    const entries = archiveEntries(bytes);
    if (entries.length !== expected.size || entries.some(path => !expected.delete(path)) || expected.size) {
      throw codedError("ARCHIVE_MISMATCH", "ZIP entries do not match changed Target files; export-ignore may have excluded files.");
    }
    try {
      signal?.throwIfAborted();
      const file = join(temporary, "archive.zip");
      await writeFile(file, bytes, { flag: "wx", signal });
      signal?.throwIfAborted();
      // A hard link publishes the complete archive atomically and never replaces an existing file.
      await link(file, zipPath);
      return zipPath;
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      if (cause.code === "EEXIST") throw codedError("OUTPUT_EXISTS", `Output already exists: ${zipPath}`, cause);
      throw codedError("ARCHIVE_FAILED", `Could not write archive: ${zipPath}`, cause);
    }
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
};
