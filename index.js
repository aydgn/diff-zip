#!/usr/bin/env node

import { checkbox, confirm, select } from "@inquirer/prompts";
import { checkGitInstalled, checkGitRepo, getBranches, createBranchesArray, getDiff, isWorkingTreeClean } from "./src/gitUtils.js";
import { createZip } from "./src/archiverUtils.js";

// Centralized error handler
const handleCriticalError = (message, error) => {
  console.error(`❌ Error: ${message}`);
  if (error) {
    console.error(error);
  }
  process.exit(1);
};

// Main application logic
async function main() {
  try {
    // Check if git is installed
    await checkGitInstalled();

    // Check if folder is a git repo
    await checkGitRepo();

    // Get all branches
    const branches = await getBranches();

    // Create an array from branches of the git repo
    const branchesArray = createBranchesArray(branches);

    // Check if there are enough branches to compare
    if (branchesArray.length < 2) {
      handleCriticalError("Not enough branches available in the repository to perform a comparison. You need at least two branches.", null);
      // The handleCriticalError function already calls process.exit(1), so no further action needed here.
      // However, to be explicit and for linters/static analysis that might not see through handleCriticalError:
      return; // Exit main function
    }

    // Ask for two branches to compare
    const selectedBranches = await checkbox({
      message: "Select two branches to compare",
      choices: branchesArray.map(branch => ({ name: branch, value: branch })),
      validate: answer => {
        // Ensures that the user selects exactly two branches for comparison.
        if (answer.length !== 2) {
          return "Please select ONLY 2 branches";
        }
        return true;
      },
    });

    // Destructure the selected branches for easier access.
    const [branch1, branch2] = selectedBranches;

    // Ask for confirmation before proceeding with the diff and zip creation.
    const isConfirmed = await confirm({
      message: `Are you sure you want to create zip file from the diff of ${branch1} and ${branch2}?`,
      default: true,
    });

    if (isConfirmed) {
      // Before generating the diff, check if the Git working tree is clean.
      // This prevents accidental inclusion of uncommitted or unstaged changes.
      const isClean = await isWorkingTreeClean();
      if (!isClean) {
        // If the working tree is not clean, prompt the user for action.
        const uncleanTreeAction = await select({
          message: "Your working tree is not clean. What would you like to do?",
          choices: [
            { name: "Proceed anyway", value: "proceed", description: "Continue without stashing changes." },
            { name: "Stash changes and abort (manual stash required for now)", value: "stash", description: "You'll need to manually stash then re-run." },
            { name: "Abort", value: "abort", description: "Stop the operation." },
          ],
        });

        // If the user chooses to abort or stash (which currently requires manual stashing), exit.
        if (uncleanTreeAction === "abort" || uncleanTreeAction === "stash") {
          console.log("❌ Operation aborted by user due to unclean working tree.");
          process.exit(0); // Graceful exit
        }
        // If the user chooses "proceed", the script will continue to getDiff.
      }

      // Get the list of filenames that differ between the two selected branches.
      const diffFileNames = await getDiff(branch1, branch2);

      // Check if the list of changed files is empty
      if (diffFileNames.length === 0) {
        console.log(`ℹ️ No differences found between ${branch1} and ${branch2}.`);
        process.exit(0); // Graceful exit
      }

      await createZip(branch1, branch2, diffFileNames);
    } else {
      console.log("❌ Aborted by user.");
      process.exit(0); // Graceful exit
    }
  } catch (error) {
    // Check if the error is specifically an ExitPromptError from inquirer
    if (error && error.name === 'ExitPromptError') {
      console.log("ℹ️ User forced the app to close.");
      process.exit(0); // Graceful exit as it's a user action
    } else {
      // For all other types of errors, use the existing handler
      handleCriticalError("An unexpected error occurred during the process.", error);
    }
  }
}

// Start the application
main();
