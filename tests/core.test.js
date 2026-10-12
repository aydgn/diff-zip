import { afterEach, test, expect } from "bun:test";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createDiffZip } from "../src/core.js";
import { buildZipName } from "../src/archiverUtils.js";
import { cleanupFixtures, commit, git, makeFixtureRepo, putFiles, readZip, tempDirectory } from "./fixtures.js";

afterEach(cleanupFixtures);

const date = new Date(2026, 0, 2, 3, 4);
const archive = fixture => createDiffZip({ ...fixture, date });
const names = entries => [...entries.keys()].sort();

test("copied content archives only the new path and leaves the source untouched", async () => {
  const fixture = await makeFixtureRepo({ base: { "source.txt": "same bytes" }, target: { "copy.txt": "same bytes" } });
  const result = await archive(fixture);
  expect(result.deleted).toEqual([]);
  expect(result.archived).toEqual(["copy.txt"]);
  const entries = await readZip(result.zipPath);
  expect(names(entries)).toEqual(["copy.txt"]);
  await expectCommittedBytes(fixture, entries);
});

async function expectCommittedBytes(fixture, entries) {
  for (const [path, entry] of entries) {
    expect(entry.bytes).toEqual(await git(fixture.cwd, "--no-replace-objects", "show", `${fixture.targetSha}:${path}`));
  }
}

test("archives Target committed text and binary bytes despite dirty and missing working files", async () => {
  const binary = randomBytes(64 * 1024);
  const fixture = await makeFixtureRepo({
    base: { "modified.txt": "base", "unchanged.txt": "same" },
    target: { "modified.txt": "committed target\n", "binary.dat": binary, "added.txt": "added" },
  });
  await putFiles(fixture.cwd, { "modified.txt": "uncommitted", "binary.dat": Buffer.from([1]), "added.txt": null, "untracked.txt": "not committed" });
  const result = await archive(fixture);
  expect(result.archived.slice().sort()).toEqual(["added.txt", "binary.dat", "modified.txt"]);
  expect(result.deleted).toEqual([]);
  expect(result.skipped).toEqual([]);
  const entries = await readZip(result.zipPath);
  expect(names(entries)).toEqual(["added.txt", "binary.dat", "modified.txt"]);
  await expectCommittedBytes(fixture, entries);
  expect(entries.get("binary.dat").bytes).toEqual(binary);
});

test("archive is byte-identical when an unrelated third branch is checked out", async () => {
  const fixture = await makeFixtureRepo({ base: { "file.txt": "base" }, target: { "file.txt": "target" } });
  const first = await archive(fixture);
  await git(fixture.cwd, "checkout", "main");
  await git(fixture.cwd, "checkout", "-b", "unrelated");
  await putFiles(fixture.cwd, { "file.txt": "third branch", "other.txt": "unrelated" });
  await commit(fixture.cwd, "unrelated");
  const outDir = join(fixture.root, "second-output");
  await mkdir(outDir);
  const second = await createDiffZip({ ...fixture, outDir, date });
  expect(await readFile(second.zipPath)).toEqual(await readFile(first.zipPath));
  await expectCommittedBytes(fixture, await readZip(second.zipPath));
});

test("deleted files are reported and never included in the archive", async () => {
  const fixture = await makeFixtureRepo({ base: { "removed.txt": "old", "retained.txt": "base" }, target: { "removed.txt": null, "retained.txt": "new" } });
  const result = await archive(fixture);
  expect(result.deleted).toEqual(["removed.txt"]);
  expect(names(await readZip(result.zipPath))).toEqual(["retained.txt"]);
});

test("renames report the old path and archive only the new path even with rename config enabled", async () => {
  const fixture = await makeFixtureRepo({ base: { "old.txt": "same bytes" }, target: { "old.txt": null, "new.txt": "same bytes" } });
  await git(fixture.cwd, "config", "diff.renames", "true");
  const result = await archive(fixture);
  expect(result.deleted).toEqual(["old.txt"]);
  expect(result.archived).toEqual(["new.txt"]);
  expect(names(await readZip(result.zipPath))).toEqual(["new.txt"]);
  await expectCommittedBytes(fixture, await readZip(result.zipPath));
});

test("an empty diff returns no ZIP and leaves the output directory empty", async () => {
  const fixture = await makeFixtureRepo({ base: { "same.txt": "same" } });
  expect(await archive(fixture)).toEqual({ zipPath: null, archived: [], deleted: [], skipped: [] });
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("deletion-only diffs retain the deletion report without creating a ZIP", async () => {
  const fixture = await makeFixtureRepo({ base: { "old\nname.txt": "old" }, target: { "old\nname.txt": null } });
  expect(await archive(fixture)).toEqual({ zipPath: null, archived: [], deleted: ["old\nname.txt"], skipped: [] });
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("full slash-containing refs produce sanitized role-based ZIP names", async () => {
  const fixture = await makeFixtureRepo({ target: { "new.txt": "new" } });
  await git(fixture.cwd, "branch", "release/base", fixture.baseSha);
  await git(fixture.cwd, "update-ref", "refs/remotes/origin/feature", fixture.targetSha);
  const result = await createDiffZip({ ...fixture, base: "refs/heads/release/base", target: "refs/remotes/origin/feature", date });
  expect(result.zipPath).toBe(join(fixture.outDir, "release_base-to-origin_feature-2026-01-02-0304.zip"));
});

test("literal unusual filenames do not act as options or pathspec patterns", async () => {
  const paths = ["-option.txt", ":(glob)*", "star*.txt", "bracket[1].txt", "tab\tname.txt", "line\nname.txt", " leading trailing ", "Türkçe/日本語.txt", "\uFEFFbom.txt"];
  const target = Object.fromEntries(paths.map((path, index) => [path, `committed ${index}\n`]));
  const fixture = await makeFixtureRepo({ base: { "star-other.txt": "unchanged", "bracket1.txt": "unchanged" }, target });
  const result = await archive(fixture);
  const entries = await readZip(result.zipPath);
  expect(names(entries)).toEqual(paths.slice().sort());
  await expectCommittedBytes(fixture, entries);
});

test("symlink targets and executable modes come from the committed Target tree", async () => {
  const fixture = await makeFixtureRepo({
    base: { "link": "regular file", "run.sh": "#!/bin/sh\nexit 0\n" },
    target: { "link": { symlink: "destination.txt" }, "destination.txt": "destination", "run.sh": { content: "#!/bin/sh\nexit 0\n", mode: 0o755 } },
  });
  const result = await archive(fixture);
  const entries = await readZip(result.zipPath);
  expect(names(entries)).toEqual(["destination.txt", "link", "run.sh"]);
  expect(entries.get("link").bytes).toEqual(Buffer.from("destination.txt"));
  expect(entries.get("link").mode & 0o170000).toBe(0o120000);
  expect(entries.get("run.sh").mode & 0o111).toBe(0o111);
  await expectCommittedBytes(fixture, entries);
});

test("changed gitlinks are reported and excluded while ordinary files are archived", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  await git(fixture.cwd, "update-index", "--add", "--cacheinfo", `160000,${fixture.baseSha},vendor/module`);
  fixture.targetSha = await commit(fixture.cwd, "add gitlink", { stage: false });
  const result = await archive(fixture);
  expect(result.skipped).toEqual([{ path: "vendor/module", reason: "submodule" }]);
  expect(result.archived).toEqual(["file.txt"]);
  expect(names(await readZip(result.zipPath))).toEqual(["file.txt"]);
});

test("gitlink-only changes return their skipped report without creating a ZIP", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "update-index", "--add", "--cacheinfo", `160000,${fixture.baseSha},module`);
  fixture.targetSha = await commit(fixture.cwd, "add gitlink", { stage: false });
  expect(await archive(fixture)).toEqual({ zipPath: null, archived: [], deleted: [], skipped: [{ path: "module", reason: "submodule" }] });
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("deleted gitlinks remain in the deletion report", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "update-index", "--add", "--cacheinfo", `160000,${fixture.baseSha},module`);
  const withModule = await commit(fixture.cwd, "add gitlink", { stage: false });
  await git(fixture.cwd, "update-ref", fixture.base, withModule);
  await git(fixture.cwd, "update-index", "--force-remove", "module");
  await commit(fixture.cwd, "remove gitlink", { stage: false });
  expect(await archive(fixture)).toEqual({ zipPath: null, archived: [], deleted: ["module"], skipped: [] });
});

test("export-ignore omissions fail loudly and leave no partial archive", async () => {
  const fixture = await makeFixtureRepo({ base: { ".gitattributes": "hidden.txt export-ignore\n", "hidden.txt": "base" }, target: { "hidden.txt": "target", "visible.txt": "visible" } });
  await expect(archive(fixture)).rejects.toMatchObject({ code: "ARCHIVE_MISMATCH" });
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("an existing output is never overwritten", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  const zipPath = join(fixture.outDir, buildZipName(fixture.base, fixture.target, date));
  const existing = Buffer.from("existing user file");
  await writeFile(zipPath, existing);
  await expect(archive(fixture)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  expect(await readFile(zipPath)).toEqual(existing);
  expect(await readdir(fixture.outDir)).toEqual([buildZipName(fixture.base, fixture.target, date)]);
});

test("invocation from a subdirectory still archives paths relative to repository root", async () => {
  const fixture = await makeFixtureRepo({ target: { "root.txt": "root", "nested/child.txt": "nested" } });
  const original = process.cwd();
  const result = await createDiffZip({ ...fixture, cwd: join(fixture.cwd, "nested"), date });
  expect(names(await readZip(result.zipPath))).toEqual(["nested/child.txt", "root.txt"]);
  expect(process.cwd()).toBe(original);
});

test("invalid refs are rejected at the boundary without output artifacts", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  for (const target of ["refs/heads/missing", "--output=unexpected", "HEAD:file.txt"]) {
    await expect(createDiffZip({ ...fixture, target, date })).rejects.toMatchObject({ code: "BAD_REF" });
  }
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("non-repositories are rejected with NOT_A_REPO", async () => {
  const cwd = await tempDirectory();
  await expect(createDiffZip({ base: "main", target: "feature", cwd, date })).rejects.toMatchObject({ code: "NOT_A_REPO" });
  expect(await readdir(cwd)).toEqual([]);
});

test("archive output failures preserve the failure and leave no partial ZIP", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  const outDir = join(fixture.root, "not-a-directory");
  await writeFile(outDir, "unchanged");
  await expect(createDiffZip({ ...fixture, outDir, date })).rejects.toMatchObject({ code: "ARCHIVE_FAILED" });
  expect(await readFile(outDir, "utf8")).toBe("unchanged");
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("local replacement commits do not change compared or archived snapshots", async () => {
  const fixture = await makeFixtureRepo({
    base: { "file.txt": "original base" },
    target: { "file.txt": "original target", "added.txt": "original addition" },
  });
  await git(fixture.cwd, "replace", fixture.targetSha, fixture.baseSha);
  const result = await archive(fixture);
  expect(result.archived.slice().sort()).toEqual(["added.txt", "file.txt"]);
  expect(result.deleted).toEqual([]);
  expect(result.skipped).toEqual([]);
  const entries = await readZip(result.zipPath);
  expect(names(entries)).toEqual(["added.txt", "file.txt"]);
  await expectCommittedBytes(fixture, entries);
});

for (const setting of ["diff.ignoreSubmodules", "submodule.module.ignore"]) {
  test(`existing gitlink bumps remain skipped-only with ${setting}=all`, async () => {
    const fixture = await makeFixtureRepo({
      base: { ".gitmodules": '[submodule "module"]\n\tpath = module\n\turl = https://example.invalid/module\n' },
    });
    const firstModule = fixture.baseSha;
    const secondModule = fixture.targetSha;
    await git(fixture.cwd, "update-index", "--add", "--cacheinfo", `160000,${firstModule},module`);
    const base = await commit(fixture.cwd, "existing gitlink", { stage: false });
    await git(fixture.cwd, "update-index", "--cacheinfo", `160000,${secondModule},module`);
    const target = await commit(fixture.cwd, "bump gitlink", { stage: false });
    await git(fixture.cwd, "config", setting, "all");
    expect(await createDiffZip({ ...fixture, base, target, date })).toEqual({
      zipPath: null, archived: [], deleted: [], skipped: [{ path: "module", reason: "submodule" }],
    });
    expect(await readdir(fixture.outDir)).toEqual([]);
  });
}

test("pre-aborted core preserves cancellation and creates no output", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  const controller = new AbortController();
  const reason = new Error("cancel comparison");
  controller.abort(reason);
  await expect(createDiffZip({ ...fixture, date, signal: controller.signal })).rejects.toBe(reason);
  expect(await readdir(fixture.outDir)).toEqual([]);
});
