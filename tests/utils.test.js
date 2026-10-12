import { afterEach, test, expect } from "bun:test";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { executeCommand } from "../src/utils.js";
import { cleanupFixtures, tempDirectory } from "./fixtures.js";

afterEach(cleanupFixtures);

test("executeCommand preserves untrimmed stdout", async () => {
  expect(await executeCommand(process.execPath, ["-e", "process.stdout.write('  hello\\n\\n')"])).toBe("  hello\n\n");
});

test("executeCommand preserves binary bytes across output chunks", async () => {
  const result = await executeCommand(process.execPath, ["-e", "process.stdout.write(Buffer.from([0,255,195])); setTimeout(() => process.stdout.write(Buffer.from([169,128,10])), 10)"], { encoding: null });
  expect(Buffer.isBuffer(result)).toBe(true);
  expect(result).toEqual(Buffer.from([0, 255, 195, 169, 128, 10]));
});

test("executeCommand uses explicit cwd and environment without changing parent cwd", async () => {
  const cwd = await tempDirectory();
  const original = process.cwd();
  const result = await executeCommand(process.execPath, ["-e", "process.stdout.write(process.cwd() + '\\n' + process.env.DIFF_ZIP_FIXTURE)"], { cwd, env: { ...process.env, DIFF_ZIP_FIXTURE: "fixture value" } });
  expect(result).toBe(`${cwd}\nfixture value`);
  expect(process.cwd()).toBe(original);
});

test("executeCommand rejects failed commands and preserves useful stderr", async () => {
  try {
    await executeCommand(process.execPath, ["-e", "process.stdout.write(Buffer.from([0,255])); process.stderr.write('fixture failure'); process.exit(7)"], { encoding: null });
    throw new Error("Expected command rejection");
  } catch (error) {
    expect(error.exitCode).toBe(7);
    expect(error.stdout).toEqual(Buffer.from([0, 255]));
    expect(error.stderr).toBe("fixture failure");
    expect(error.message).toContain("fixture failure");
  }
});

test("executeCommand rejects unavailable executables", async () => {
  await expect(executeCommand("diff-zip-nonexistent-fixture-command")).rejects.toMatchObject({ code: "ENOENT" });
});

test("executeCommand rejects an early-aborted signal without executing side effects", async () => {
  const cwd = await tempDirectory();
  const marker = join(cwd, "should-not-exist");
  const controller = new AbortController();
  controller.abort();
  await expect(executeCommand(process.execPath, ["-e", "require('node:fs').writeFileSync(process.env.MARKER, 'ran')"], { signal: controller.signal, env: { ...process.env, MARKER: marker } })).rejects.toBe(controller.signal.reason);
  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

test("executeCommand cancellation waits for trapped termination and child close", async () => {
  const cwd = await tempDirectory();
  const ready = join(cwd, "ready");
  const marker = join(cwd, "closed");
  const controller = new AbortController();
  let timer;
  let watcher;
  const started = new Promise((resolve, reject) => {
    watcher = watch(cwd, (_, filename) => {
      if (filename === "ready") resolve();
    });
    timer = setTimeout(() => reject(new Error("Child did not announce readiness")), 3000);
  });
  const script = `const fs = require("node:fs");
    process.on("SIGTERM", () => {
      setTimeout(() => {
        fs.writeFileSync(process.env.MARKER, "terminated");
        process.exit(0);
      }, 100);
    });
    setInterval(() => {}, 1000);
    fs.writeFileSync(process.env.READY, String(process.pid));`;
  const outcome = executeCommand(process.execPath, ["-e", script], { signal: controller.signal, env: { ...process.env, READY: ready, MARKER: marker } }).then(
    () => { throw new Error("Expected command cancellation"); },
    error => error,
  );
  try {
    await started;
    const pid = Number(await readFile(ready, "utf8"));
    controller.abort();
    expect(await outcome).toBe(controller.signal.reason);
    expect(await readFile(marker, "utf8")).toBe("terminated");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    clearTimeout(timer);
    watcher.close();
    controller.abort();
    await outcome;
  }
});
