import { afterEach, test, expect } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { delimiter, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { archiveCommittedFiles, buildZipName } from "../src/archiverUtils.js";
import { createDiffZip } from "../src/core.js";
import { cleanupFixtures, git, makeFixtureRepo, readZip } from "./fixtures.js";

const exec = promisify(execFile);
const date = new Date(2026, 0, 2, 3, 4);
const coreUrl = new URL("../src/core.js", import.meta.url).href;
const childEnvironment = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
});

async function runCoreWithEnvironment(fixture, env = childEnvironment()) {
  const options = { base: fixture.base, target: fixture.target, cwd: fixture.cwd, outDir: fixture.outDir };
  const script = `import { createDiffZip } from ${JSON.stringify(coreUrl)}; const result = await createDiffZip({ ...${JSON.stringify(options)}, date: new Date(2026, 0, 2, 3, 4) }); process.stdout.write(JSON.stringify(result));`;
  const { stdout, stderr } = await exec("node", ["--input-type=module", "-e", script], { cwd: fixture.cwd, env, timeout: 10000 });
  expect(stderr).toBe("");
  return JSON.parse(stdout);
}

test("buildZipName uses role direction and zero-padded local date and time", () => {
  expect(buildZipName("main", "origin/feature", new Date(2026, 0, 2, 3, 4))).toBe("main-to-origin_feature-2026-01-02-0304.zip");
});

test("buildZipName strips full ref prefixes and replaces both path separators", () => {
  expect(buildZipName("refs/heads/release/2026", "refs/remotes/origin/feature\\fix", new Date(2026, 10, 12, 13, 45))).toBe("release_2026-to-origin_feature_fix-2026-11-12-1345.zip");
});

afterEach(cleanupFixtures);

for (const location of ["absolute", "relative"]) {
  test(`environment-only ${location} alternate stores preserve committed bytes and isolate source attributes`, async () => {
    const literal = "Target $Format:%H$\n$Format:%s$\n";
    const repo = await makeFixtureRepo({
      base: { ".gitattributes": "release.txt export-subst\n", "release.txt": "Base\n" },
      target: { "release.txt": literal },
    });
    const blob = (await git(repo.cwd, "rev-parse", `${repo.targetSha}:release.txt`)).toString("utf8").trim();
    const objects = join(repo.cwd, ".git", "objects");
    const stores = [join(repo.root, "base-objects"), join(repo.root, "target:\u001b\u0001\n\t\"\\é")];
    await rename(objects, stores[0]);
    await mkdir(objects);
    await mkdir(join(stores[1], blob.slice(0, 2)), { recursive: true });
    await rename(join(stores[0], blob.slice(0, 2), blob.slice(2)), join(stores[1], blob.slice(0, 2), blob.slice(2)));
    const attributes = join(repo.cwd, ".git", "info", "attributes");
    const rules = "release.txt export-ignore export-subst\n";
    await writeFile(attributes, rules);
    await git(repo.cwd, "config", "--local", "core.attributesFile", attributes);
    await writeFile(join(repo.cwd, ".gitattributes"), "* export-ignore export-subst\n");
    await writeFile(join(repo.cwd, "release.txt"), "Dirty working-tree content\n");
    const prefix = location === "relative" ? ".." : repo.root;
    const first = location === "relative" ? relative(repo.cwd, stores[0]) : stores[0];
    const second = `"${prefix}/target:\\033\\001\\n\\t\\\"\\\\é"`;
    const result = await runCoreWithEnvironment(repo, {
      ...childEnvironment(),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: [first, second].join(delimiter),
    });
    expect(result.archived).toEqual(["release.txt"]);
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([]);
    const entries = await readZip(result.zipPath);
    expect([...entries.keys()]).toEqual(["release.txt"]);
    expect(entries.get("release.txt").bytes).toEqual(Buffer.from(literal));
    expect(await readFile(attributes, "utf8")).toBe(rules);
    expect(await readFile(join(repo.cwd, "release.txt"), "utf8")).toBe("Dirty working-tree content\n");
    expect(await readdir(objects)).toEqual([]);
    expect(await readdir(repo.outDir)).toEqual([buildZipName(repo.base, repo.target, date)]);
  }, 15000);
}

test("control-character repository-root paths archive committed bytes under Node", async () => {
  const repo = await makeFixtureRepo({ target: { "file.txt": "Committed Target bytes\n" } });
  const cwd = join(repo.root, "repo-\u001b\u0001");
  await rename(repo.cwd, cwd);
  const result = await runCoreWithEnvironment({ ...repo, cwd });
  expect(result.archived).toEqual(["file.txt"]);
  expect((await readZip(result.zipPath)).get("file.txt").bytes).toEqual(Buffer.from("Committed Target bytes\n"));
  expect(await readdir(repo.outDir)).toEqual([buildZipName(repo.base, repo.target, date)]);
}, 15000);

test("buildZipName compacts two 120-character labels with the stable ordered digest", () => {
  const base = "a".repeat(120);
  const target = "b".repeat(120);
  const date = new Date(2026, 0, 2, 3, 4);
  expect(buildZipName(base, target, date)).toBe("diff-1a76b6cb108993ca-2026-01-02-0304.zip");
  expect(buildZipName(target, base, date)).not.toBe(buildZipName(base, target, date));
  expect(buildZipName(base, "c".repeat(120), date)).not.toBe(buildZipName(base, target, date));
});

test("buildZipName bounds the complete UTF-8 basename rather than its character count", () => {
  const date = new Date(2026, 0, 2, 3, 4);
  const base = "界".repeat(40);
  const target = "語".repeat(35) + "abcdef";
  const expected = `${base}-to-${target}-2026-01-02-0304.zip`;
  expect(Buffer.byteLength(expected, "utf8")).toBe(255);
  expect(buildZipName(base, target, date)).toBe(expected);
  const compact = buildZipName(base, target + "c", date);
  expect(compact).toMatch(/^diff-[a-f0-9]{16}-2026-01-02-0304\.zip$/);
  expect(Buffer.byteLength(compact, "utf8")).toBeLessThanOrEqual(255);
});

test("archiveCommittedFiles refuses an existing output without replacing it", async () => {
  const repo = await makeFixtureRepo({ target: { "file.txt": "committed" } });
  const zipPath = join(repo.outDir, "existing.zip");
  await writeFile(zipPath, "user-owned archive");
  await expect(archiveCommittedFiles({ commit: repo.targetSha, paths: ["file.txt"], cwd: repo.cwd, outDir: repo.outDir, name: "existing.zip" })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  expect(await readFile(zipPath, "utf8")).toBe("user-owned archive");
  expect(await readdir(repo.outDir)).toEqual(["existing.zip"]);
});

test("competing Base and Target writers publish one complete winner without overwriting unrelated files", async () => {
  const repo = await makeFixtureRepo({
    base: { "shared.txt": "Base payload\n", "base-only.txt": "Base only\n" },
    target: { "shared.txt": "Target payload\n", "base-only.txt": null, "target-only.txt": "Target only\n" },
  });
  await writeFile(join(repo.outDir, "keep.txt"), "Unrelated content\n");
  const candidates = [
    { commit: repo.baseSha, files: { "shared.txt": "Base payload\n", "base-only.txt": "Base only\n" } },
    { commit: repo.targetSha, files: { "shared.txt": "Target payload\n", "target-only.txt": "Target only\n" } },
  ];
  const results = await Promise.allSettled(candidates.map(({ commit, files }) => archiveCommittedFiles({
    commit, paths: Object.keys(files), cwd: repo.cwd, outDir: repo.outDir, name: "competing.zip",
  })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected").reason).toMatchObject({ code: "OUTPUT_EXISTS" });
  const winner = results.findIndex(result => result.status === "fulfilled");
  const entries = await readZip(results[winner].value);
  expect([...entries.keys()].sort()).toEqual(Object.keys(candidates[winner].files).sort());
  for (const [path, expected] of Object.entries(candidates[winner].files)) {
    expect(entries.get(path).bytes).toEqual(Buffer.from(expected));
  }
  expect((await readdir(repo.outDir)).sort()).toEqual(["competing.zip", "keep.txt"]);
  expect(await readFile(join(repo.outDir, "keep.txt"), "utf8")).toBe("Unrelated content\n");
});

test("archiveCommittedFiles rejects early cancellation without creating temporary output", async () => {
  const repo = await makeFixtureRepo({ target: { "file.txt": "committed" } });
  const controller = new AbortController();
  controller.abort();
  await expect(archiveCommittedFiles({ commit: repo.targetSha, paths: ["file.txt"], cwd: repo.cwd, outDir: repo.outDir, name: "cancelled.zip", signal: controller.signal })).rejects.toBe(controller.signal.reason);
  expect(await readdir(repo.outDir)).toEqual([]);
});

test("active archive cancellation reaps real Git, preserves the original reason and removes staging", async () => {
  const payload = Buffer.alloc(4 * 1024 * 1024);
  let state = 1;
  for (let index = 0; index < payload.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    payload[index] = state >>> 24;
  }
  const repo = await makeFixtureRepo({ target: { "payload.bin": payload } });
  await writeFile(join(repo.outDir, "keep.txt"), "Unrelated content\n");
  const node = (await exec("node", ["-p", "process.execPath"])).stdout.trim();
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const boundary = join(repo.root, "git-boundary");
  const readyPath = join(repo.root, "archive-ready.json");
  const closedPath = join(repo.root, "archive-closed.json");
  await mkdir(boundary);
  const executable = join(boundary, "git");
  await writeFile(executable, `#!${node}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const archiving = args.includes("archive");
const child = spawn(${JSON.stringify(realGit)}, args, { stdio: archiving ? ["ignore", "pipe", "inherit"] : "inherit" });
if (archiving) {
  // Block a real archive after its first output; a large incompressible payload keeps it active.
  child.stdout.once("readable", () => {
    child.kill("SIGSTOP");
    writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid, gitPid: child.pid }));
  });
}
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
  if (archiving) {
    child.kill("SIGCONT");
    child.stdout.resume();
  }
});
child.on("close", (code, signal) => {
  if (archiving) writeFileSync(${JSON.stringify(closedPath)}, JSON.stringify({ pid: process.pid, gitPid: child.pid, signal }));
  process.exit(code ?? 1);
});
`);
  await chmod(executable, 0o755);
  const options = { base: repo.base, target: repo.target, cwd: repo.cwd, outDir: repo.outDir };
  const script = `
import { createDiffZip } from ${JSON.stringify(coreUrl)};
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
const controller = new AbortController();
const reason = new Error("cancel the active archive");
process.once("SIGTERM", () => controller.abort(reason));
let outcome;
const running = createDiffZip({ ...${JSON.stringify(options)}, date: new Date(2026, 0, 2, 3, 4), signal: controller.signal }).then(
  value => { outcome = { value }; }, error => { outcome = { error }; },
);
try {
  const deadline = Date.now() + 7000;
  let ready;
  while (!ready) {
    if (outcome) throw outcome.error ?? new Error("archive completed before cancellation");
    try { ready = JSON.parse(await readFile(${JSON.stringify(readyPath)}, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!ready) {
      if (Date.now() >= deadline) throw new Error("real Git archive did not become ready");
      await setTimeout(10);
    }
  }
  process.kill(ready.gitPid, 0);
} finally {
  controller.abort(reason);
  await running;
}
process.stdout.write(JSON.stringify({ sameReason: outcome.error === reason }));
`;
  const { stdout, stderr } = await exec(node, ["--input-type=module", "-e", script], {
    cwd: repo.cwd,
    env: { ...childEnvironment(), PATH: [boundary, process.env.PATH].join(delimiter) },
    timeout: 10000,
  });
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ sameReason: true });
  const ready = JSON.parse(await readFile(readyPath, "utf8"));
  const closed = JSON.parse(await readFile(closedPath, "utf8"));
  expect(closed).toEqual({ ...ready, signal: "SIGTERM" });
  expect(() => process.kill(closed.gitPid, 0)).toThrow("ESRCH");
  expect(() => process.kill(closed.pid, 0)).toThrow("ESRCH");
  expect(await readdir(repo.outDir)).toEqual(["keep.txt"]);
  expect(await readFile(join(repo.outDir, "keep.txt"), "utf8")).toBe("Unrelated content\n");
}, 15000);

test("a real partial clone with missing blobs fails without lazy fetching or leaving artifacts", async () => {
  const donor = await makeFixtureRepo({
    base: { "file.txt": "Base blob\n" },
    target: { "file.txt": "Missing Target blob\n" },
  });
  await git(donor.cwd, "config", "uploadpack.allowFilter", "true");
  const blob = (await git(donor.cwd, "rev-parse", `${donor.targetSha}:file.txt`)).toString("utf8").trim();
  const cwd = join(donor.root, "partial-clone");
  await git(donor.root, "clone", "--filter=blob:none", "--no-checkout", pathToFileURL(donor.cwd).href, cwd);
  const before = (await git(cwd, "rev-list", "--objects", "--all", "--missing=print")).toString("utf8");
  expect(before.split("\n")).toContain(`?${blob}`);
  const objectsBefore = (await git(cwd, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)")).toString("utf8").split("\n").sort();
  expect(objectsBefore).not.toContain(blob);
  await writeFile(join(donor.outDir, "keep.txt"), "Unrelated content\n");
  await expect(createDiffZip({ base: donor.baseSha, target: donor.targetSha, cwd, outDir: donor.outDir, date })).rejects.toMatchObject({ code: "ARCHIVE_FAILED" });
  expect((await git(cwd, "rev-list", "--objects", "--all", "--missing=print")).toString("utf8")).toBe(before);
  expect((await git(cwd, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)")).toString("utf8").split("\n").sort()).toEqual(objectsBefore);
  expect(await readdir(donor.outDir)).toEqual(["keep.txt"]);
  expect(await readFile(join(donor.outDir, "keep.txt"), "utf8")).toBe("Unrelated content\n");
}, 15000);
