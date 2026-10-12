import { afterEach, test, expect } from "bun:test";
import { watch } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { archiveCommittedFiles, buildZipName } from "../src/archiverUtils.js";
import { cleanupFixtures, makeFixtureRepo } from "./fixtures.js";

test("buildZipName uses role direction and zero-padded local date and time", () => {
  expect(buildZipName("main", "origin/feature", new Date(2026, 0, 2, 3, 4))).toBe("main-to-origin_feature-2026-01-02-0304.zip");
});

test("buildZipName strips full ref prefixes and replaces both path separators", () => {
  expect(buildZipName("refs/heads/release/2026", "refs/remotes/origin/feature\\fix", new Date(2026, 10, 12, 13, 45))).toBe("release_2026-to-origin_feature_fix-2026-11-12-1345.zip");
});

afterEach(cleanupFixtures);

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

test("archiveCommittedFiles rejects early cancellation without creating temporary output", async () => {
  const repo = await makeFixtureRepo({ target: { "file.txt": "committed" } });
  const controller = new AbortController();
  controller.abort();
  await expect(archiveCommittedFiles({ commit: repo.targetSha, paths: ["file.txt"], cwd: repo.cwd, outDir: repo.outDir, name: "cancelled.zip", signal: controller.signal })).rejects.toBe(controller.signal.reason);
  expect(await readdir(repo.outDir)).toEqual([]);
});

test("archiveCommittedFiles cleans its temporary repository on cancellation and leaves other files intact", async () => {
  const repo = await makeFixtureRepo({ target: { "file.txt": "committed" } });
  await writeFile(join(repo.outDir, "keep.txt"), "unrelated");
  const controller = new AbortController();
  const watcher = watch(repo.outDir, (_, filename) => {
    if (filename?.startsWith(".diff-zip-")) controller.abort();
  });
  try {
    const error = await archiveCommittedFiles({ commit: repo.targetSha, paths: ["file.txt"], cwd: repo.cwd, outDir: repo.outDir, name: "cancelled.zip", signal: controller.signal }).then(
      () => { throw new Error("Expected archive cancellation"); },
      cause => cause,
    );
    expect(error).toBe(controller.signal.reason);
    expect(controller.signal.aborted).toBe(true);
    expect(await readdir(repo.outDir)).toEqual(["keep.txt"]);
    expect(await readFile(join(repo.outDir, "keep.txt"), "utf8")).toBe("unrelated");
  } finally {
    watcher.close();
  }
});
