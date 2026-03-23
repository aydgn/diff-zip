import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, unlinkSync, mkdtempSync, readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../src/archiverUtils.js";

test("createZip writes a zip archive and resolves with the filename", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "diff-zip-test-"));
  writeFileSync(join(tmpDir, "file.txt"), "hello");

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  let zipName;
  try {
    zipName = await createZip("main", "feature", ["file.txt"]);
    assert.ok(existsSync(zipName), "zip file should exist");
    assert.ok(zipName.startsWith("main-feature-"), "filename should start with branch names");
    assert.ok(zipName.endsWith(".zip"), "filename should end with .zip");
  } finally {
    process.chdir(originalCwd);
    if (zipName && existsSync(join(tmpDir, zipName))) unlinkSync(join(tmpDir, zipName));
    unlinkSync(join(tmpDir, "file.txt"));
    rmdirSync(tmpDir);
  }
});

test("createZip replaces slashes in branch names with underscores", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "diff-zip-test-"));
  writeFileSync(join(tmpDir, "file.txt"), "hello");

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  let zipName;
  try {
    zipName = await createZip("feature/foo", "release/bar", ["file.txt"]);
    assert.ok(zipName.includes("feature_foo-release_bar"), "slashes replaced with underscores");
  } finally {
    process.chdir(originalCwd);
    if (zipName && existsSync(join(tmpDir, zipName))) unlinkSync(join(tmpDir, zipName));
    unlinkSync(join(tmpDir, "file.txt"));
    rmdirSync(tmpDir);
  }
});

test("createZip skips empty filenames in diff list", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "diff-zip-test-"));
  writeFileSync(join(tmpDir, "real.txt"), "data");

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  let zipName;
  try {
    zipName = await createZip("a", "b", ["real.txt", "", "  "]);
    assert.ok(existsSync(zipName), "zip should still be created");
  } finally {
    process.chdir(originalCwd);
    if (zipName && existsSync(join(tmpDir, zipName))) unlinkSync(join(tmpDir, zipName));
    unlinkSync(join(tmpDir, "real.txt"));
    rmdirSync(tmpDir);
  }
});
