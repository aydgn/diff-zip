import { afterEach, test, expect, setDefaultTimeout } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiffZip } from "../src/core.js";
import { cleanupFixtures, commit, git, makeFixtureRepo, putFiles, readZip } from "./fixtures.js";

afterEach(cleanupFixtures);
setDefaultTimeout(15000);

const exec = promisify(execFile);
const date = new Date(2026, 0, 2, 3, 4);
const archive = fixture => createDiffZip({ ...fixture, date });
const literal = "Target release: $Format:%H$\n$Format:%s$\n";

async function expectTargetFile(result, expected = literal) {
  expect(result.archived).toEqual(["release.txt"]);
  expect(result.deleted).toEqual([]);
  expect(result.skipped).toEqual([]);
  const entries = await readZip(result.zipPath);
  expect([...entries.keys()]).toEqual(["release.txt"]);
  expect(entries.get("release.txt").bytes).toEqual(Buffer.from(expected));
}

async function releaseFixture(attributes = "") {
  return makeFixtureRepo({
    base: { ".gitattributes": attributes, "release.txt": "Base release\n" },
    target: { "release.txt": literal },
  });
}

test("committed export-subst preserves literal Target blob bytes instead of expanding commit placeholders", async () => {
  const fixture = await releaseFixture("release.txt export-subst\n");
  await expectTargetFile(await archive(fixture));
});

test("repository info attributes cannot omit or substitute changed Target files", async () => {
  const fixture = await releaseFixture();
  const attributes = join(fixture.cwd, ".git", "info", "attributes");
  const rules = "release.txt export-ignore export-subst\n";
  await writeFile(attributes, rules);
  await expectTargetFile(await archive(fixture));
  expect(await readFile(attributes, "utf8")).toBe(rules);
});

test("local core.attributesFile cannot influence the Target archive", async () => {
  const fixture = await releaseFixture();
  const attributes = join(fixture.root, "local-attributes");
  await writeFile(attributes, "release.txt export-ignore export-subst\n");
  await git(fixture.cwd, "config", "--local", "core.attributesFile", attributes);
  await expectTargetFile(await archive(fixture));
  expect((await git(fixture.cwd, "config", "--local", "core.attributesFile")).toString("utf8").trim()).toBe(attributes);
});

for (const source of ["global config", "environment config"]) {
  test(`${source} attributes cannot influence the Target archive`, async () => {
    const fixture = await releaseFixture();
    const attributes = join(fixture.root, "external-attributes");
    const config = join(fixture.root, "global-config");
    await writeFile(attributes, "release.txt export-ignore export-subst\n");
    await writeFile(config, `[core]\n\tattributesFile = ${JSON.stringify(attributes)}\n`);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const env = {
      ...inherited,
      HOME: fixture.root,
      XDG_CONFIG_HOME: fixture.root,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: source === "global config" ? config : "/dev/null",
      ...(source === "environment config" ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.attributesFile",
        GIT_CONFIG_VALUE_0: attributes,
      } : {}),
    };
    const coreUrl = new URL("../src/core.js", import.meta.url).href;
    const options = { base: fixture.base, target: fixture.target, cwd: fixture.cwd, outDir: fixture.outDir };
    const script = `import { createDiffZip } from ${JSON.stringify(coreUrl)}; const result = await createDiffZip({ ...${JSON.stringify(options)}, date: new Date(2026, 0, 2, 3, 4) }); process.stdout.write(JSON.stringify(result));`;
    const { stdout, stderr } = await exec(process.execPath, ["--input-type=module", "-e", script], { cwd: fixture.cwd, env, timeout: 10000 });
    expect(stderr).toBe("");
    await expectTargetFile(JSON.parse(stdout));
  });
}

test("an unrelated branch and dirty working-tree attributes cannot override Target attributes", async () => {
  const fixture = await releaseFixture("release.txt export-subst\n");
  await git(fixture.cwd, "checkout", "-b", "unrelated", fixture.baseSha);
  await putFiles(fixture.cwd, { ".gitattributes": "release.txt export-ignore\n", "release.txt": "Unrelated branch\n" });
  await commit(fixture.cwd, "unrelated attribute rules");
  const dirtyRules = "* export-ignore export-subst\n";
  await writeFile(join(fixture.cwd, ".gitattributes"), dirtyRules);
  await expectTargetFile(await archive(fixture));
  expect((await git(fixture.cwd, "symbolic-ref", "--short", "HEAD")).toString("utf8").trim()).toBe("unrelated");
  expect(await readFile(join(fixture.cwd, ".gitattributes"), "utf8")).toBe(dirtyRules);
  expect(await readFile(join(fixture.cwd, "release.txt"), "utf8")).toBe("Unrelated branch\n");
});

test("committed nested export-ignore still fails with ARCHIVE_MISMATCH despite local unsetting rules", async () => {
  const fixture = await makeFixtureRepo({
    base: { "nested/.gitattributes": "hidden.txt export-ignore\n", "nested/hidden.txt": "Base\n" },
    target: { "nested/hidden.txt": "Target\n", "visible.txt": "Visible\n" },
  });
  const rules = "nested/hidden.txt -export-ignore\n";
  await writeFile(join(fixture.cwd, ".git", "info", "attributes"), rules);
  await writeFile(join(fixture.cwd, "nested", ".gitattributes"), "hidden.txt -export-ignore\n");
  const attributes = join(fixture.root, "override-attributes");
  await writeFile(attributes, rules);
  await git(fixture.cwd, "config", "--local", "core.attributesFile", attributes);
  await expect(archive(fixture)).rejects.toMatchObject({ code: "ARCHIVE_MISMATCH" });
  expect(await readdir(fixture.outDir)).toEqual([]);
});

test("Target nested attributes apply even when their directory is absent from the working tree", async () => {
  const fixture = await makeFixtureRepo({
    base: { "nested/.gitattributes": "release.txt export-subst\n", "nested/release.txt": "Base\n" },
    target: { "nested/release.txt": literal },
  });
  await git(fixture.cwd, "checkout", fixture.base);
  await putFiles(fixture.cwd, { nested: null });
  const result = await archive(fixture);
  expect(result.archived).toEqual(["nested/release.txt"]);
  const entries = await readZip(result.zipPath);
  expect([...entries.keys()]).toEqual(["nested/release.txt"]);
  expect(entries.get("nested/release.txt").bytes).toEqual(Buffer.from(literal));
  expect(await readdir(fixture.cwd)).not.toContain("nested");
});
