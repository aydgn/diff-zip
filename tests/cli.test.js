import { afterEach, test, expect, setDefaultTimeout } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readFile, writeFile, mkdir, readdir, chmod, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBranchChoices, formatReportPath, printDiffReport } from "../src/cliUtils.js";
import { cleanupFixtures, commit, git, makeFixtureRepo, putFiles, readZip, tempDirectory } from "./fixtures.js";

afterEach(cleanupFixtures);
setDefaultTimeout(15000);

const cliPath = fileURLToPath(new URL("../index.js", import.meta.url));
const nodePath = Bun.which("node");

function runCli(args, cwd, { noGit = false, input = "" } = {}) {
  if (!nodePath) throw new Error("CLI process tests require Node.js.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return new Promise((resolve, reject) => {
    const child = execFile(nodePath, [cliPath, ...args], {
      cwd,
      env: { ...env, TZ: "UTC", ...(noGit ? { PATH: cwd } : {}) },
      encoding: "utf8",
      timeout: 10000,
    }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== "number" || error.killed || error.signal)) {
        reject(error);
        return;
      }
      resolve({ status: error?.code ?? 0, stdout, stderr });
    });
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}

async function runInterruptedCli(args, cwd, signal) {
  if (!nodePath) throw new Error("CLI process tests require Node.js.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  let child;
  let closed;
  let timer;
  let sent = false;
  let stdout = "";
  let stderr = "";
  let rejectWatch;
  const watching = new Promise((_, reject) => { rejectWatch = reject; });
  // Observe the actual staging directory, with the watcher armed before spawning.
  const watcher = watch(cwd, (_event, filename) => {
    if (sent || !filename?.toString().startsWith(".diff-zip-")) return;
    void stat(join(cwd, filename.toString())).then(info => {
      if (sent || !info.isDirectory()) return;
      sent = true;
      if (!child.kill(signal)) rejectWatch(new Error(`Could not send ${signal} to the CLI.`));
    }, error => { if (error.code !== "ENOENT") rejectWatch(error); });
  });
  watcher.on("error", rejectWatch);
  try {
    child = spawn(nodePath, [cliPath, ...args], { cwd, env: { ...env, TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    closed = new Promise(resolve => child.once("close", (status, exitSignal) => resolve({ status, exitSignal, stdout, stderr })));
    child.once("error", rejectWatch);
    timer = setTimeout(() => rejectWatch(new Error("Timed out waiting for interrupted CLI cleanup.")), 10000);
    const result = await Promise.race([closed, watching]);
    if (!sent) throw new Error("CLI exited without creating an observed staging directory.");
    return result;
  } finally {
    watcher.close();
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      try { await closed; } finally { clearTimeout(force); }
    }
  }
}

const branches = {
  local: [{ name: "feature", ref: "refs/heads/feature" }, { name: "main", ref: "refs/heads/main" }],
  remote: [{ name: "origin/main", ref: "refs/remotes/origin/main" }],
};

test("branch choices preserve local then remote full-ref identity", () => {
  const choices = buildBranchChoices(branches, "role description");
  expect(choices.map(choice => choice.value ?? "separator")).toEqual([
    "separator", "refs/heads/feature", "refs/heads/main", "separator", "refs/remotes/origin/main",
  ]);
});

test("Target exclusion uses full ref and omits empty groups", () => {
  const choices = buildBranchChoices({ local: [{ name: "origin/main", ref: "refs/heads/origin/main" }], remote: branches.remote }, "target", "refs/heads/origin/main");
  expect(choices.map(choice => choice.value ?? "separator")).toEqual(["separator", "refs/remotes/origin/main"]);
  expect(buildBranchChoices({ local: [], remote: [] }, "target")).toEqual([]);
});

test("ordinary report paths remain readable while control characters stay on one physical line", () => {
  expect(formatReportPath("folder/Türkçe name.txt")).toBe("folder/Türkçe name.txt");
  expect(formatReportPath("line\nname\t.txt")).toBe('"line\\nname\\t.txt"');
  for (const path of ["line\rname", "escape\x1b[31m", "delete\x7f", "next\u0085line", "line\u2028break", "line\u2029break"]) {
    const rendered = formatReportPath(path);
    expect(rendered.startsWith('"')).toBe(true);
    expect(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(rendered)).toBe(false);
  }
});

test("reports include deletion and submodule paths without physical control characters", () => {
  const lines = [];
  printDiffReport({ deleted: ["old.txt", "old\nname"], skipped: [{ path: "vendor/module", reason: "submodule" }] }, line => lines.push(line));
  expect(lines).toContain("  - old.txt");
  expect(lines).toContain('  - "old\\nname"');
  expect(lines).toContain("  - vendor/module");
  expect(lines.every(line => !/[\r\n]/u.test(line))).toBe(true);
  const empty = [];
  printDiffReport({ deleted: [], skipped: [] }, line => empty.push(line));
  expect(empty).toEqual([]);
});

test("deletion-only and skipped-only reports do not depend on a ZIP", () => {
  const deleted = [];
  printDiffReport({ zipPath: null, deleted: ["old.txt"], skipped: [] }, line => deleted.push(line));
  expect(deleted).toContain("  - old.txt");
  expect(deleted.some(line => line.includes("module"))).toBe(false);
  const skipped = [];
  printDiffReport({ zipPath: null, deleted: [], skipped: [{ path: "module", reason: "submodule" }] }, line => skipped.push(line));
  expect(skipped).toContain("  - module");
  expect(skipped.some(line => line.includes("old.txt"))).toBe(false);
});

test("standalone help aliases print usage outside Git without Git in PATH", async () => {
  const cwd = await tempDirectory();
  const help = await runCli(["--help"], cwd, { noGit: true });
  const shortHelp = await runCli(["-h"], cwd, { noGit: true });
  for (const result of [help, shortHelp]) {
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("git-diff-zip");
    expect(result.stdout).toMatch(/BASE\s+TARGET/u);
    expect(result.stdout).toContain("--help");
    expect(result.stdout).toContain("--version");
  }
  expect(shortHelp.stdout).toBe(help.stdout);
  expect(await readdir(cwd)).toEqual([]);
});

test("standalone --version prints only package version outside Git without Git in PATH", async () => {
  const cwd = await tempDirectory();
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const result = await runCli(["--version"], cwd, { noGit: true });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${packageJson.version}\n`);
  expect(result.stderr).toBe("");
});

const invalidArguments = [
  ["main"], ["main", "feature", "extra"], ["--unknown"], ["-v"],
  ["-main", "feature"], ["main", "-feature"],
  ["", "feature"], ["main", ""],
  ["--help", "main"], ["main", "--version"], ["--help", "--version"],
];

for (const args of invalidArguments) {
  test(`invalid arguments ${JSON.stringify(args)} fail before Git or prompts`, async () => {
    const cwd = await tempDirectory();
    const result = await runCli(args, cwd, { noGit: true });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("INVALID_ARGUMENTS");
    expect(result.stderr).toContain("--help");
    expect(result.stderr).not.toContain("GIT_NOT_FOUND");
    expect(await readdir(cwd)).toEqual([]);
  });
}

test("positional mode archives committed Target bytes at the repository root without confirmation", async () => {
  const fixture = await makeFixtureRepo({
    base: { "changed.txt": "base bytes", "removed.txt": "old bytes" },
    target: { "changed.txt": "committed target bytes", "added.txt": "committed addition", "removed.txt": null },
  });
  await git(fixture.cwd, "branch", "-m", "GM-12345");
  await putFiles(fixture.cwd, { "changed.txt": "dirty target bytes", "added.txt": null, "untracked.txt": "not committed" });
  const nested = join(fixture.cwd, "nested");
  await mkdir(nested);
  const beforeHead = await git(fixture.cwd, "rev-parse", "HEAD");
  const beforeStatus = await git(fixture.cwd, "status", "--porcelain", "--untracked-files=no");
  const result = await runCli(["main", "GM-12345"], nested, { input: "n\n" });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("[SUCCESS]");
  expect(result.stdout).toContain("removed.txt");
  const zipNames = (await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"));
  expect(zipNames).toHaveLength(1);
  expect(zipNames[0]).toMatch(/^main-to-GM-12345-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/u);
  const zipPath = join(fixture.cwd, zipNames[0]);
  expect(result.stdout).toContain(zipPath);
  const entries = await readZip(zipPath);
  expect([...entries.keys()].sort()).toEqual(["added.txt", "changed.txt"]);
  expect(entries.get("changed.txt").bytes.toString()).toBe("committed target bytes");
  expect(entries.get("added.txt").bytes.toString()).toBe("committed addition");
  expect(await readdir(nested)).toEqual([]);
  expect(await git(fixture.cwd, "rev-parse", "HEAD")).toEqual(beforeHead);
  expect(await git(fixture.cwd, "status", "--porcelain", "--untracked-files=no")).toEqual(beforeStatus);
  expect(await readFile(join(fixture.cwd, "changed.txt"), "utf8")).toBe("dirty target bytes");
});

test("reversing operands archives the second operand's bytes and reverses deletions", async () => {
  const fixture = await makeFixtureRepo({ base: { "old.txt": "base bytes" }, target: { "old.txt": null, "new.txt": "target bytes" } });
  const result = await runCli(["feature", "main"], fixture.cwd);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("new.txt");
  const zipNames = (await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"));
  expect(zipNames).toHaveLength(1);
  const entries = await readZip(join(fixture.cwd, zipNames[0]));
  expect([...entries.keys()]).toEqual(["old.txt"]);
  expect(entries.get("old.txt").bytes.toString()).toBe("base bytes");
});

for (const kind of ["full refs", "remote-tracking refs", "commit SHAs", "commit expressions"]) {
  test(`positional mode accepts ${kind} without branch selection`, async () => {
    const fixture = await makeFixtureRepo({ target: { "new.txt": "target bytes" } });
    let refs;
    if (kind === "full refs") refs = [fixture.base, fixture.target];
    if (kind === "remote-tracking refs") {
      await git(fixture.cwd, "update-ref", "refs/remotes/origin/main", fixture.baseSha);
      await git(fixture.cwd, "update-ref", "refs/remotes/origin/feature", fixture.targetSha);
      refs = ["origin/main", "refs/remotes/origin/feature"];
    }
    if (kind === "commit SHAs") {
      await git(fixture.cwd, "branch", "-D", "main");
      refs = [fixture.baseSha, fixture.targetSha];
    }
    if (kind === "commit expressions") {
      await git(fixture.cwd, "branch", "-D", "main");
      refs = ["HEAD~1", "HEAD"];
    }
    const result = await runCli(refs, fixture.cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const zipNames = (await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"));
    expect(zipNames).toHaveLength(1);
    const entries = await readZip(join(fixture.cwd, zipNames[0]));
    expect([...entries.keys()]).toEqual(["new.txt"]);
    expect(entries.get("new.txt").bytes.toString()).toBe("target bytes");
  });
}

test("same ref succeeds without a ZIP with only one local branch", async () => {
  const fixture = await makeFixtureRepo({ target: { "file.txt": "target" } });
  await git(fixture.cwd, "branch", "-D", "main");
  const result = await runCli(["feature", "feature"], fixture.cwd);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("[INFO]");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
});

test("distinct refs with identical snapshots succeed without a ZIP", async () => {
  const fixture = await makeFixtureRepo({ base: { "file.txt": "same bytes" } });
  const result = await runCli(["main", "feature"], fixture.cwd);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("[INFO]");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
});

test("multiline commit-message refs stay escaped on one no-differences report line", async () => {
  const fixture = await makeFixtureRepo({ base: { "file.txt": "same bytes" } });
  await commit(fixture.cwd, "target\ncontinuation");
  const multilineRef = "HEAD^{/target\ncontinuation}";
  for (const refs of [["HEAD", multilineRef], [multilineRef, "HEAD"]]) {
    const result = await runCli(refs, fixture.cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout).toContain('"HEAD^{/target\\ncontinuation}"');
    expect(result.stdout).not.toContain(multilineRef);
    expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
  }
});

test("deletion-only positional mode reports escaped paths on stdout without a ZIP", async () => {
  const fixture = await makeFixtureRepo({ base: { "old\nname.txt": "old" }, target: { "old\nname.txt": null } });
  const result = await runCli(["main", "feature"], fixture.cwd);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain('"old\\nname.txt"');
  expect(result.stdout).not.toContain("old\nname.txt");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
});

test("submodule-only positional mode reports skipped paths without a ZIP", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "update-index", "--add", "--cacheinfo", `160000,${fixture.baseSha},vendor/module`);
  await commit(fixture.cwd, "add gitlink", { stage: false });
  const result = await runCli(["main", "feature"], fixture.cwd);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("vendor/module");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
});

for (const args of [["missing-base", "feature"], ["main", "missing-target"]]) {
  test(`unresolvable operand ${JSON.stringify(args)} exits one with BAD_REF`, async () => {
    const fixture = await makeFixtureRepo();
    const result = await runCli(args, fixture.cwd);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("BAD_REF");
    expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"))).toEqual([]);
  });
}

test("positional mode without Git exits one with GIT_NOT_FOUND", async () => {
  const cwd = await tempDirectory();
  const result = await runCli(["main", "feature"], cwd, { noGit: true });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("GIT_NOT_FOUND");
});

test("positional mode outside a Git repository exits one with NOT_A_REPO", async () => {
  const cwd = await tempDirectory();
  const result = await runCli(["main", "feature"], cwd);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("NOT_A_REPO");
});

test.skipIf(process.getuid?.() === 0)("permission-denied archive errors retain original escaped cause diagnostics", async () => {
  const fixture = await makeFixtureRepo({ target: { "new.txt": "committed" } });
  const cwd = join(fixture.root, "repo\n\u001bdenied");
  await rename(fixture.cwd, cwd);
  const mode = (await stat(cwd)).mode & 0o777;
  let result;
  try {
    await chmod(cwd, 0o555);
    result = await runCli(["main", "feature"], cwd);
  } finally {
    await chmod(cwd, mode);
  }
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  const lines = result.stderr.trimEnd().split("\n");
  expect(lines[0]).toContain("[FAIL] ARCHIVE_FAILED:");
  expect(lines.slice(1).some(line => line.includes("[CAUSE]") && line.includes("EACCES") && line.includes("mkdtemp"))).toBe(true);
  expect(result.stderr).toContain("\\n");
  expect(result.stderr).toContain("\\u001b");
  expect(result.stderr).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/u);
  expect((await readdir(cwd)).filter(name => name.endsWith(".zip") || name.startsWith(".diff-zip-"))).toEqual([]);
});

test("archive failures exit one on stderr without a partial ZIP", async () => {
  const fixture = await makeFixtureRepo({ target: { ".gitattributes": "hidden.txt export-ignore\n", "hidden.txt": "committed" } });
  const result = await runCli(["main", "feature"], fixture.cwd);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("ARCHIVE_MISMATCH");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip") || name.startsWith(".diff-zip-"))).toEqual([]);
});

for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  test(`active ${signal} interruption awaits cleanup and exits ${status}`, async () => {
    const fixture = await makeFixtureRepo({ target: { "large.txt": Buffer.alloc(8 * 1024 * 1024, "target bytes") } });
    const result = await runInterruptedCli(["main", "feature"], fixture.cwd, signal);
    expect(result.status).toBe(status);
    expect(result.exitSignal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(signal);
    expect(result.stderr).toMatch(/cancel/i);
    expect(result.stderr).not.toContain("[FAIL]");
    expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip") || name.startsWith(".diff-zip-"))).toEqual([]);
  });
}

for (const [kind, base, target] of [
  ["120-character refs", "b".repeat(120), "t".repeat(120)],
  ["multibyte refs", "基".repeat(50), "新".repeat(50)],
]) {
  test(`${kind} archive committed Target bytes with bounded hashed filenames`, async () => {
    const fixture = await makeFixtureRepo({ base: { "changed.txt": "base" }, target: { "changed.txt": "committed Target bytes" } });
    await git(fixture.cwd, "branch", "-m", "main", base);
    await git(fixture.cwd, "branch", "-m", "feature", target);
    await putFiles(fixture.cwd, { "changed.txt": "dirty working bytes" });
    const result = await runCli([base, target], fixture.cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("[SUCCESS]");
    const names = (await readdir(fixture.cwd)).filter(name => name.endsWith(".zip"));
    expect(names).toHaveLength(1);
    const digest = createHash("sha256").update(base).update("\0").update(target).digest("hex").slice(0, 16);
    expect(names[0]).toMatch(new RegExp(`^diff-${digest}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.zip$`, "u"));
    expect(Buffer.byteLength(names[0], "utf8")).toBeLessThanOrEqual(255);
    const entries = await readZip(join(fixture.cwd, names[0]));
    expect([...entries.keys()]).toEqual(["changed.txt"]);
    expect(entries.get("changed.txt").bytes.toString()).toBe("committed Target bytes");
    expect((await readdir(fixture.cwd)).filter(name => name.startsWith(".diff-zip-"))).toEqual([]);
  });
}

test("no-argument mode still requires two selectable branches before prompting", async () => {
  const fixture = await makeFixtureRepo();
  await git(fixture.cwd, "branch", "-D", "main");
  const result = await runCli([], fixture.cwd);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("[FAIL]");
  expect((await readdir(fixture.cwd)).filter(name => name.endsWith(".zip") || name.startsWith(".diff-zip-"))).toEqual([]);
});

test("minute filename collisions fail without overwriting existing files", async () => {
  const fixture = await makeFixtureRepo({ target: { "new.txt": "target" } });
  const names = [];
  // Cover a minute boundary without controlling the child process clock.
  const now = Date.now();
  for (const offset of [-60000, 0, 60000]) {
    const date = new Date(now + offset);
    const pad = value => String(value).padStart(2, "0");
    const name = `main-to-feature-${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}.zip`;
    names.push(name);
    await writeFile(join(fixture.cwd, name), "existing output must survive");
  }
  const result = await runCli(["main", "feature"], fixture.cwd);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("OUTPUT_EXISTS");
  const outputs = (await readdir(fixture.cwd)).filter(name => name.endsWith(".zip") || name.startsWith(".diff-zip-"));
  expect(outputs.sort()).toEqual(names.sort());
  for (const name of names) expect(await readFile(join(fixture.cwd, name), "utf8")).toBe("existing output must survive");
});
