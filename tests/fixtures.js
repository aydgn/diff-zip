import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const exec = promisify(execFile);
const roots = new Set();

export async function tempDirectory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diff-zip-test-")));
  roots.add(root);
  return root;
}

export async function cleanupFixtures() {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })));
  roots.clear();
}

export async function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "buffer",
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: "2026-01-02T03:04:00Z",
      GIT_COMMITTER_DATE: "2026-01-02T03:04:00Z",
    },
  });
  return stdout;
}

export async function putFiles(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(cwd, path);
    await mkdir(dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    if (content === null) continue;
    if (typeof content === "object" && !Buffer.isBuffer(content)) {
      if (content.symlink !== undefined) await symlink(content.symlink, destination);
      else {
        await writeFile(destination, content.content);
        if (content.mode !== undefined) await chmod(destination, content.mode);
      }
    } else {
      await writeFile(destination, content);
    }
  }
}

export async function commit(cwd, message, { stage = true } = {}) {
  if (stage) await git(cwd, "add", "--all");
  await git(cwd, "commit", "--allow-empty", "-m", message);
  return (await git(cwd, "rev-parse", "HEAD")).toString("utf8").trim();
}

export async function makeFixtureRepo({ base = {}, target = {} } = {}) {
  const root = await tempDirectory();
  const cwd = join(root, "repo");
  const outDir = join(root, "output");
  await mkdir(cwd);
  await mkdir(outDir);
  await git(cwd, "init", "--initial-branch=main");
  for (const [key, value] of Object.entries({
    "user.name": "Diff Zip Fixture",
    "user.email": "fixture@example.invalid",
    "commit.gpgsign": "false",
    "core.autocrlf": "false",
    "core.symlinks": "true",
    "core.filemode": "true",
  })) await git(cwd, "config", "--local", key, value);
  await putFiles(cwd, base);
  const baseSha = await commit(cwd, "base");
  await git(cwd, "checkout", "-b", "feature");
  await putFiles(cwd, target);
  const targetSha = await commit(cwd, "target");
  return { root, cwd, outDir, baseSha, targetSha, base: "refs/heads/main", target: "refs/heads/feature" };
}

// Independent ZIP reader: central-directory sizes also handle streaming data descriptors.
export async function readZip(path) {
  const zip = await readFile(path);
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error("Missing ZIP end record");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP directory entry");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const mode = zip.readUInt32LE(offset + 38) >>> 16;
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local entry");
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const compressed = zip.subarray(start, start + compressedSize);
    let bytes;
    if (method === 0) bytes = compressed;
    else if (method === 8) bytes = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression ${method}`);
    if (bytes.length !== size) throw new Error("ZIP entry size mismatch");
    if (!name.endsWith("/")) entries.set(name, { bytes, mode });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
