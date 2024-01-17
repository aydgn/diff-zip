#!/usr/bin/env node

// This CLI tools is for creating zip file from the diff of two branches
import { execSync } from "child_process";
import inquirer from "inquirer";
import archiver from "archiver";
import { createWriteStream } from "fs";

// Check if git is installed
try {
  execSync("git --version");
} catch (error) {
  console.log("❌ Please install git. You can download it from https://git-scm.com/downloads");
  process.exit(1);
}

// Check if folder is a git repo
try {
  const isGitRepo = execSync("git rev-parse --is-inside-work-tree").toString().trim();

  if (!isGitRepo) {
    throw new Error();
  }
} catch (error) {
  console.error("!!! Error on checking if folder is a git repo");
  process.exit(1);
}

// Get all branches
const branches = execSync("git branch -a");
const branchesArray = () => {
  return branches
    .toString() // Convert buffer to string
    .split("\n") // Split by new line
    .map(branch => branch.replace("*", "").trim()) // Remove * and trim
    .filter(branch => branch !== ""); // Remove empty string
};

const createZip = (branch1, branch2, diff) => {
  // Create zip file
  const archive = archiver("zip", { zlib: { level: 9 } });
  const now = new Date().getTime();
  const output = createWriteStream(`${branch1}-${branch2}-${now}.zip`);

  output.on("close", () => {
    console.log(`✅ ${branch1}-${branch2}.zip created`);
    console.log(`✅ Total bytes: ${archive.pointer()}`);
  });

  archive.on("error", err => {
    throw err;
  });

  archive.pipe(output);

  // Add files to zip
  for (const file of diff.split("\n")) {
    archive.file(file, { name: file });
  }

  archive.finalize();
};

// Ask for two branches to compare
inquirer
  .prompt([
    {
      type: "checkbox",
      name: "branches",
      message: "Select two branches to compare",
      choices: branchesArray(),
      validate: answer => {
        if (answer.length !== 2) {
          return "Please select ONLY 2 branches";
        }

        return true;
      },
    },
  ])
  .then(answers => {
    const [branch1, branch2] = answers.branches;

    // Ask for confirmation
    inquirer
      .prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Are you sure you want to create zip file from the diff of ${branch1} and ${branch2}?`,
        },
      ])
      .then(answer => {
        if (answer.confirm) {
          // Get diff of two branches
          const diff = execSync(`git diff --name-only ${branch1} ${branch2}`).toString().trim();

          // Create zip file
          createZip(branch1, branch2, diff);
        } else {
          console.log("❌ Aborted");
          process.exit(1);
        }
      });
  });
