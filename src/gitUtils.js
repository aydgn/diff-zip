import { executeCommand } from "./utils.js";

const GIT_COMMAND = "git";
const GIT_VERSION_ARGS = ["--version"];
const GIT_REPO_CHECK_ARGS = ["rev-parse", "--is-inside-work-tree"];
const GIT_BRANCHES_ARGS = ["branch", "-a"];
const GIT_DIFF_BASE_ARGS = ["diff", "--name-only"];
const GIT_STATUS_PORCELAIN_ARGS = ["status", "--porcelain"];

// Check if git is installed
export const checkGitInstalled = () => executeCommand(GIT_COMMAND, GIT_VERSION_ARGS);

// Check if folder is a git repo
export const checkGitRepo = () => executeCommand(GIT_COMMAND, GIT_REPO_CHECK_ARGS);

// Get all branches
export const getBranches = () => executeCommand(GIT_COMMAND, GIT_BRANCHES_ARGS);

// Get list of changed files between two branches
export const getDiff = async (branch1, branch2) => {
  // Construct the arguments for 'git diff --name-only <branch1> <branch2>'
  const diffArgs = [...GIT_DIFF_BASE_ARGS, branch1, branch2];
  // Execute the git diff command
  const output = await executeCommand(GIT_COMMAND, diffArgs);
  // Split the string by newline characters to get an array of filenames.
  // Filter out any empty strings that might result from an extra newline at the end of the git output.
  return output
    .split("\n")
    .filter(file => file && file.trim() !== ""); // Ensure file is not null, undefined, or just whitespace
};

// Create an array of branch names from the raw output of 'git branch -a'
export const createBranchesArray = branches => {
  // Convert string to array by new line to process each branch entry.
  const branchLines = branches.split("\n");

  return branchLines
    .map(branch => {
      // Trim whitespace from the raw branch string.
      let processedBranch = branch.trim();
      // The current branch is prefixed with '* '. Remove this prefix.
      // e.g., "* main" becomes "main".
      if (processedBranch.startsWith("* ")) {
        processedBranch = processedBranch.substring(2).trim();
      }
      // Some entries might be remote tracking branches like 'remotes/origin/feature-branch'.
      // These are generally fine, but we filter out symbolic refs later.
      return processedBranch;
    })
    // Filter out any empty strings that might result from processing (e.g., trailing newlines).
    // Also, filter out symbolic references like 'remotes/origin/HEAD -> origin/main'.
    // These are not actual branches that can be selected for a diff.
    .filter(branch => branch && branch.trim() !== "" && !branch.includes(" -> "));
};

// Check if the working tree is clean (no uncommitted changes or untracked files)
export const isWorkingTreeClean = async () => {
  const output = await executeCommand(GIT_COMMAND, GIT_STATUS_PORCELAIN_ARGS);
  return output === "";
};
