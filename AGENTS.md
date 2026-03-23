# DiffZip Repository Guidelines

DiffZip is a Node.js CLI tool that creates ZIP archives containing only the files that have changed between two Git branches, facilitating selective deployments.

## Project Architecture & Organization

The project is a Node.js ESM CLI application (`"type": "module"`) published as `git-diff-zip`.

- **`index.js`**: CLI entry point and orchestrator. Handles Git checks, interactive branch selection (via `@inquirer/prompts`), and high-level logic flow.
- **`src/gitUtils.js`**: Wrappers for Git CLI operations: `checkGitInstalled`, `checkGitRepo`, `getBranches`, `getDiff`, and `isWorkingTreeClean`.
- **`src/archiverUtils.js`**: Archive creation logic using the `archiver` library. Formats output as `<branch1>-<branch2>-<timestamp>.zip`.
- **`src/utils.js`**: Core process execution helper using `child_process.spawn` for robust shell command handling.

## Development Commands

- `bun install`: Install dependencies from `bun.lock`.
- `bun run dev`: Start the CLI with `nodemon` for local iteration.
- `node index.js` or `bun index.js`: Run the tool locally from the repository root.
- `npx git-diff-zip`: Global execution via npm.
- `npm pack`: Create a publishable package tarball to verify packaging.

## Coding Style & Conventions

- **Language**: Modern ESM JavaScript (Node.js 12.0.0+).
- **Formatting**: Two-space indentation, semicolons, and double quotes.
- **Naming**: Exported functions in `camelCase`; utility modules named `*Utils.js`.
- **Best Practices**:
  - Prefer small, pure helper functions.
  - Always use `src/utils.js:executeCommand` for shell operations.
  - Centralize error handling; use `handleCriticalError` for terminal failures.
  - Keep CLI prompts and messages short, explicit, and user-friendly.

## Testing & Verification

No automated test suite is currently configured. All changes must be manually verified in a real Git repository covering these scenarios:
1. Clean working tree flow.
2. Unclean working tree flow (verify warnings).
3. Diff with changed files (verify ZIP contents).
4. Diff with no changes (verify behavior).

If adding tests, place them in `tests/` using `*.test.js` naming conventions.

## Git & Workflow Guidelines

- **Commit Messages**: Follow Conventional Commits (e.g., `fix:`, `feat:`, `chore:`, `refactor:`). Use imperative mood.
- **Pull Requests**: Explain user-visible effects, list verification steps/transcripts, and link related issues.
- **Safety**: The tool requires a clean working tree by default to avoid zipping uncommitted changes.
- **Environment**: Assumes `git` is in the system PATH and the current directory is a Git repository with at least two branches.

## Roadmap & Future Improvements

- [ ] Add unit tests for `src/` utility functions.
- [ ] Implement automatic stashing for unclean working trees.
- [ ] Support custom output directories for generated ZIP files.
