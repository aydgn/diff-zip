import { executeCommand } from "./utils.js";

// Check if git is installed
export const checkGitInstalled = () => executeCommand("git --version");

// Check if folder is a git repo
export const checkGitRepo = () => executeCommand("git rev-parse --is-inside-work-tree");

// Get all branches
export const getBranches = () => executeCommand("git branch -a");

// Get diff of two branches
export const getDiff = (branch1, branch2) => executeCommand(`git diff ${branch1} ${branch2}`);

// Create an array from branches of the git repo
export const createBranchesArray = branches => {
  return branches
    .toString() // Convert buffer to string
    .split("\n") // Split by new line
    .map(branch => branch.replace("*", "").trim()) // Remove * and trim
    .filter(branch => branch !== ""); // Remove empty string
};
