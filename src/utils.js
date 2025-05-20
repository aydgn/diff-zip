import { spawn } from "child_process";

// Executes a shell command using child_process.spawn for better security and stream handling.
// Returns a Promise that resolves with the command's stdout on success,
// or rejects with an error (including stderr and stdout for context) on failure.
export const executeCommand = (command, args = []) => {
  return new Promise((resolve, reject) => {
    // Spawn the child process.
    const process = spawn(command, args);

    let stdout = ""; // Buffer for standard output.
    let stderr = ""; // Buffer for standard error.

    // Listen for data on stdout and append it to the stdout buffer.
    process.stdout.on("data", data => {
      stdout += data.toString();
    });

    // Listen for data on stderr and append it to the stderr buffer.
    process.stderr.on("data", data => {
      stderr += data.toString();
    });

    // Listen for the 'close' event, which indicates the process has exited.
    process.on("close", code => {
      if (code !== 0) {
        // If the exit code is not 0, the command failed.
        // Create an error object with details from stderr and stdout.
        const error = new Error(`Command failed with exit code ${code}: ${stderr.trim()}`);
        error.stderr = stderr.trim(); // Attach stderr to the error object.
        error.stdout = stdout.trim(); // Attach stdout to the error object for debugging context.
        reject(error); // Reject the promise with the error.
      } else {
        // If the exit code is 0, the command succeeded.
        resolve(stdout.trim()); // Resolve the promise with the trimmed stdout.
      }
    });

    // Listen for the 'error' event, which can occur if the command cannot be spawned (e.g., command not found).
    process.on("error", err => {
      // This typically handles errors like EACCES or ENOENT.
      reject(err); // Reject the promise with the spawn error.
    });
  });
};
