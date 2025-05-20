# Changelog

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
