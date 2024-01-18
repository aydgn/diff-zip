import { exec } from "child_process";

export const executeCommand = command => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      }

      resolve(stdout.trim());
    });
  });
};
