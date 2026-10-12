import { afterEach, test, expect } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { checkGitInstalled, checkGitRepo, getBranches, getTreeEntries, parseBranches, parseNameStatus, resolveCommit } from "../src/gitUtils.js";
import { cleanupFixtures, git, makeFixtureRepo } from "./fixtures.js";

afterEach(cleanupFixtures);

const records = (...fields) => Buffer.from(`${fields.join("\0")}\0`, "utf8");

test("parseBranches preserves full identities and Git order while removing symbolic refs", () => {
  const output = "refs/heads/feature\tfeature\t\nrefs/heads/main\tmain\t\nrefs/remotes/origin/HEAD\torigin/HEAD\trefs/remotes/origin/main\nrefs/remotes/origin/feature\torigin/feature\t\nrefs/remotes/origin/main\torigin/main\t\n";
  expect(parseBranches(output)).toEqual({
    local: [{ name: "feature", ref: "refs/heads/feature" }, { name: "main", ref: "refs/heads/main" }],
    remote: [{ name: "origin/feature", ref: "refs/remotes/origin/feature" }, { name: "origin/main", ref: "refs/remotes/origin/main" }],
  });
  expect(parseBranches("")).toEqual({ local: [], remote: [] });
});

test("getBranches distinguishes ambiguous short refs and reports the current full ref", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "branch", "origin/main");
  await git(fixture.cwd, "update-ref", "refs/remotes/origin/main", fixture.baseSha);
  await git(fixture.cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(fixture.cwd, "checkout", "main");
  expect(await getBranches(fixture.cwd)).toEqual({
    local: [
      { name: "feature", ref: "refs/heads/feature" },
      { name: "main", ref: "refs/heads/main" },
      { name: "heads/origin/main", ref: "refs/heads/origin/main" },
    ],
    remote: [{ name: "remotes/origin/main", ref: "refs/remotes/origin/main" }],
    current: "refs/heads/main",
  });
});

test("getBranches accepts one local plus one remote and handles detached HEAD", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "checkout", "main");
  await git(fixture.cwd, "branch", "-D", "feature");
  await git(fixture.cwd, "update-ref", "refs/remotes/origin/main", fixture.targetSha);
  const branches = await getBranches(fixture.cwd);
  expect(branches.local).toEqual([{ name: "main", ref: "refs/heads/main" }]);
  expect(branches.remote).toEqual([{ name: "origin/main", ref: "refs/remotes/origin/main" }]);
  await git(fixture.cwd, "checkout", "--detach", fixture.targetSha);
  expect((await getBranches(fixture.cwd)).current).toBeNull();
});

test("parseNameStatus classifies adds modifications type changes and deletions", () => {
  expect(parseNameStatus(records("A", "added", "M", "modified", "T", "link", "D", "deleted"))).toEqual({
    changed: ["added", "modified", "link"], deleted: ["deleted"],
  });
  expect(parseNameStatus(Buffer.alloc(0))).toEqual({ changed: [], deleted: [] });
});

test("parseNameStatus consumes both rename and copy paths", () => {
  expect(parseNameStatus(records("R100", "old", "new", "C075", "source", "copied", "M", "next"))).toEqual({
    changed: ["new", "copied", "next"], deleted: ["old"],
  });
});

test("parseNameStatus preserves whitespace control characters and Unicode paths", () => {
  const paths = [" leading and trailing ", "tab\tname", "line\nname", "Türkçe/日本語.txt", "\uFEFFbom.txt", ":(glob)*", "--option"];
  expect(parseNameStatus(records(...paths.flatMap(path => ["A", path])))).toEqual({ changed: paths, deleted: [] });
});

for (const fields of [["U", "file"], ["X", "file"], ["B", "file"], ["Q", "file"], ["R", "old", "new"], ["R101", "old", "new"], ["Cbad", "old", "new"], ["A", ""], ["M"], ["R100", "old"], ["A", "file", ""]]) {
  test(`parseNameStatus rejects malformed or unsupported record ${JSON.stringify(fields)}`, () => {
    assert.throws(() => parseNameStatus(records(...fields)), { code: "INVALID_DIFF" });
  });
}

test("parseNameStatus rejects unterminated data instead of dropping a path", () => {
  assert.throws(() => parseNameStatus(Buffer.from("A\0file")), { code: "INVALID_DIFF" });
});

test("parseNameStatus rejects invalid UTF-8 deletion paths", () => {
  assert.throws(() => parseNameStatus(Buffer.from([0x44, 0, 0xff, 0])), { code: "INVALID_DIFF" });
});

test("resolution expressions and tree reads ignore local replacement objects", async () => {
  const fixture = await makeFixtureRepo({ target: { "added.txt": "original" } });
  await git(fixture.cwd, "replace", fixture.targetSha, fixture.baseSha);
  expect(await resolveCommit("HEAD^", fixture.cwd)).toBe(fixture.baseSha);
  expect(await resolveCommit("HEAD", fixture.cwd)).toBe(fixture.targetSha);
  expect(await getTreeEntries(fixture.targetSha, fixture.cwd)).toEqual(new Map([
    ["added.txt", { mode: "100644", type: "blob" }],
  ]));
});

test("tree decoding rejects raw invalid UTF-8 without creating invalid-byte filesystem names", async () => {
  const fixture = await makeFixtureRepo({ base: { "seed.txt": "blob content" } });
  const blob = (await git(fixture.cwd, "rev-parse", "HEAD:seed.txt")).toString("utf8").trim();
  const input = Buffer.concat([Buffer.from(`100644 blob ${blob}\t`), Buffer.from([0xff, 0])]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const tree = execFileSync("git", ["mktree", "-z"], {
    cwd: fixture.cwd, input, encoding: "utf8",
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  await expect(getTreeEntries(tree, fixture.cwd)).rejects.toMatchObject({ code: "INVALID_DIFF" });
});

test("tree decoding preserves BOM, controls, and valid Unicode paths", async () => {
  const paths = ["\uFEFFbom.txt", "tab\tline\n.txt", "Türkçe日本語.txt"];
  const fixture = await makeFixtureRepo({ target: Object.fromEntries(paths.map(path => [path, "content"])) });
  const tree = await getTreeEntries(fixture.targetSha, fixture.cwd);
  expect([...tree.keys()].sort()).toEqual(paths.slice().sort());
});

for (const helper of [checkGitInstalled, checkGitRepo, resolveCommit, getTreeEntries]) {
  test(`${helper.name} preserves pre-aborted cancellation reasons`, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel Git operation");
    controller.abort(reason);
    const args = helper === checkGitInstalled || helper === checkGitRepo
      ? [process.cwd(), controller.signal]
      : ["HEAD", process.cwd(), controller.signal];
    await expect(helper(...args)).rejects.toBe(reason);
  });
}
