#!/usr/bin/env node

import inquirer from "inquirer";
import { checkGitInstalled, checkGitRepo, getBranches, createBranchesArray, getDiff } from "./src/gitUtils.js";
import { createZip } from "./src/archiverUtils.js";

// Check if git is installed
try {
  await checkGitInstalled();
} catch (error) {
  console.error("❌ Make sure that you installed Git. You can download it from https://git-scm.com/downloads", error);
  process.exit(1);
}

// Check if folder is a git repo
try {
  await checkGitRepo();
} catch (error) {
  console.error(`❌ Make sure that the folder ${process.cwd()} is a git repo`, error);
  process.exit(1);
}

// Get all branches
const branches = await getBranches();

// Create an array from branches of the git repo
const branchesArray = createBranchesArray(branches);

// Ask for two branches to compare
inquirer
  .prompt([
    {
      type: "checkbox",
      name: "branches",
      message: "Select two branches to compare",
      choices: branchesArray,
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
          default: true,
        },
      ])
      .then(answer => {
        if (answer.confirm) {
          const diff = getDiff(branch1, branch2).toString().trim();

          createZip(branch1, branch2, diff);
        } else {
          console.log("❌ Aborted");
          process.exit(1);
        }
      });
  });
