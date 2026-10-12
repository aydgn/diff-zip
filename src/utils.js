import { spawn } from "node:child_process";

export const executeCommand = (command, args = [], { cwd, encoding = "utf8", env, signal } = {}) => {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, { cwd, env, signal });
    const stdout = [];
    const stderr = [];
    let spawnError;
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    // Abort emits an error before termination; cleanup must wait for child I/O to close.
    child.on("error", error => { spawnError = error; });
    child.on("close", (code, terminationSignal) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (spawnError) {
        reject(spawnError);
        return;
      }
      const bytes = Buffer.concat(stdout);
      const output = encoding === null ? bytes : bytes.toString(encoding);
      if (code === 0) {
        resolve(output);
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8");
      const error = new Error(`Command failed with exit code ${code}${terminationSignal ? ` (${terminationSignal})` : ""}: ${message.trim()}`);
      error.exitCode = code;
      error.signal = terminationSignal;
      error.stdout = output;
      error.stderr = message;
      reject(error);
    });
  });
};

export const codedError = (code, message, cause) => {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
};
