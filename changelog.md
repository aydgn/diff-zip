# Changelog

## 3.0.0 - Unreleased (prepared 2026-10-12)

Publication is pending registry and release authorization. The configured package is `@aydgn/git-diff-zip` on GitHub Packages (`https://npm.pkg.github.com`); the executable remains `git-diff-zip`. No public npm availability is implied.

### Breaking changes
- Archive content now comes exclusively from resolved Target commit snapshots, never the working tree. Dirty working trees are allowed; the clean-tree guard is removed.
- Deleted Files are reported separately for manual destination cleanup and never included in the ZIP. Rename detection is disabled, so renames appear as an old-path deletion and new-path addition.
- Changed submodules are skipped and reported separately. Runs with only deletions or skipped submodules create no ZIP.
- ZIP names now use `<Base>-to-<Target>-YYYY-MM-DD-HHmm.zip` in local time, replacing branch-name slashes and backslashes with underscores. Existing output paths fail with `OUTPUT_EXISTS` instead of being overwritten.
- Replaced unordered two-branch checkbox selection with sequential Base → Target selection.

### Changed
- Added prompt-free `git-diff-zip BASE TARGET` (Base first) for scripts and AI coding agents, including no-TTY/piped-input use. Positional mode accepts commit refs without branch enumeration or the interactive two-branch guard; no-argument selection and confirmation remain unchanged.
- Added standalone English `--help`/`-h`, available outside Git, covering archive/deployment constraints and agent workflow. Help/version must stand alone; unsupported flags and malformed operand counts fail with `INVALID_ARGUMENTS` before Git checks or prompts.
- Documented explicit-ref agent execution, human stdout/stderr reports, and exit codes without adding flags, dependencies, or a dedicated Agent Skill.
- Replaced the `archiver` dependency with Git committed-object archiving in an isolated bare repository. Ambient Git configuration and working-tree attributes cannot alter archive content; `export-subst` is disabled to preserve blob bytes.
- Validate the ZIP entry set before publication. Committed `export-ignore` that excludes required paths fails with `ARCHIVE_MISMATCH`, leaving no partial output ZIP.
- Extracted the prompt-free `createDiffZip` core API, returning `zipPath` (or `null`), `archived`, `deleted`, and `skipped`.
- Grouped branch choices into sorted Local and Remote sections using full-ref identities, excluded symbolic remote HEAD refs and the selected Base from Target choices, and retained the current branch as default when available.
- Adopted Turkish Base/Target selection and confirmation prompts; retained English operational results, distinct deletion/submodule lists, and escaped control characters in displayed paths.
- Updated `@inquirer/prompts` to `^8.7.0`, added `bun test`, and limited runtime package files to `index.js` and `src/` alongside npm-included metadata and README.
- Updated usage and contributor documentation for snapshot semantics, registry identity, collision behavior, deployment cleanup, and known OS argument-length/in-memory ZIP limits. Windows remains unverified.
- Bounded output ZIP names by 255 UTF-8 bytes with a deterministic SHA-256 fallback (`diff-<hash>-<timestamp>.zip`).
- Enforced fatal UTF-8 decoding for committed diff/tree paths (`INVALID_DIFF`).
- Consistently passed `--no-replace-objects` and `--ignore-submodules=none` across commit resolution and diffs.
- Added active-operation `SIGINT`/`SIGTERM` cancellation with child-process termination and temporary cleanup (exits 130/143).
- Preserved actionable error cause diagnostics on stderr.
- Gated unattended release publication on `oven-sh/setup-bun@v2`, frozen lockfile installation, and `bun test` on `published` release events.

### Verification (original correctness implementation)
- Orchestrator verified 59 passing Bun tests, 0 failures, and 151 expectations across 6 test files; language-server diagnostics for source, entry point, and tests were clear, and frozen-lockfile installation left the lockfile unchanged.
- Real Node PTY checks passed eight scenarios: dirty Target content/deletion reporting, output collision, confirmation rejection, Ctrl+C, no differences, deletion-only/no ZIP, one-branch guard, and a long Remote branch at 40 columns. The same scenarios passed using the installed package binary; version output was `3.0.0`.
- Installed-package ZIP inspection confirmed committed Target bytes, exclusion of dirty worktree content and deleted paths, and the expected entry list. A disposable linked-worktree smoke check also passed. Documentation-inclusive packaging verification is recorded in the release ticket.

### Verification (positional CLI and help)
- Real Node positional/help smoke passed from source and the installed 8-file package: prompt-free committed Target bytes, invalid argument/ref failures, help/version without Git, same refs, one-branch commit comparisons, and deletion-only output. PTY checks retained interactive selection/confirmation rejection and graceful Ctrl+C.

### Verification (review fixes)
- Full suite passed: 111 tests across 6 files, 0 failures; diagnostics clean; frozen lockfile unchanged.
- Verified Git replacements, ignore-all submodules, invalid UTF-8 paths, long refs, permissions diagnostics, SIGINT/SIGTERM cancellation, and zero attributes test leftovers.

## 2.0.0 - 2026-07-06

### Changed
- Updated `@inquirer/prompts` to `^8.5.2` and `archiver` to `^8.0.0`.
- Raised the Node.js engine requirement to match the upgraded prompt stack: `>=23.5.0 || ^22.13.0 || ^20.17.0`.
- Migrated archive creation to `archiver@8`'s `ZipArchive` named export.

## 1.0.4 - 2025-05-21

### Added
- Created this changelog to document significant project developments.

### Changed
- **Core Logic & Error Handling:**
    - Implemented `async/await` in [`index.js`](index.js:0) for enhanced error handling and asynchronous flow control.
    - Refactored [`src/archiverUtils.js`](src/archiverUtils.js:0) to use Promise-based error handling for more robust archive creation.
    - Modified [`src/gitUtils.js`](src/gitUtils.js:0) to use `git diff --name-only` for more efficient diff retrieval.
    - Reimplemented `executeCommand` in [`src/utils.js`](src/utils.js:0) using `spawn` for better process management and error capturing.
- **Robustness & Stability:**
    - Added pre-command checks in Git interactions to ensure a clean working tree before proceeding.
    - Improved overall code structure with clearer constant definitions and more descriptive variable names.
    - Added a check for empty diffs to prevent errors when no changes are detected.
    - Addressed potential issues with detached HEAD states during branch comparison.
    - Ensured archiver checks for empty filenames to prevent errors during ZIP creation.
- **Dependencies & Configuration:**
    - Updated the `inquirer` dependency to `@inquirer/prompts` for a more modern and performant prompting experience.
    - Enhanced [`.gitignore`](.gitignore:0) to exclude common development files and directories.
    - Updated scripts in [`package.json`](package.json:0) for consistency and clarity.
- **Code Clarity:**
    - Added inline comments throughout the codebase to improve understanding and maintainability.

## 2025-05-20

### Added
- Created this changelog to document significant project developments.
