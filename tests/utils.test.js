import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCommand } from "../src/utils.js";

test("executeCommand resolves with stdout on success", async () => {
  const result = await executeCommand("node", ["--version"]);
  assert.match(result, /^v\d+\.\d+\.\d+$/);
});

test("executeCommand rejects on non-zero exit code", async () => {
  await assert.rejects(
    () => executeCommand("node", ["-e", "process.exit(1)"]),
    /Command failed with exit code 1/
  );
});

test("executeCommand rejects when command not found", async () => {
  await assert.rejects(() => executeCommand("__nonexistent_cmd__", []));
});
