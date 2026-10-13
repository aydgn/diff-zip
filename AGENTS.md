# DiffZip Repository Guidelines

DiffZip is a Node.js ESM CLI that compares committed Base and Target snapshots and produces a Diff Zip for selective deployment. Read `CONTEXT.md` when changing domain terminology; read `README.md` when changing user-visible behavior.

## Module boundaries

- **`index.js`**: CLI entry point. Owns argument validation, standalone help/version, positional comparisons, interactive Base/Target selection and confirmation, orchestration, cancellation, and terminal errors. Importing core modules must not start prompts or terminate the process.
- **`src/core.js`**: `createDiffZip({ base, target, cwd, outDir, date })` resolves commit snapshots, classifies changes, and coordinates archiving. Returns `{ zipPath, archived, deleted, skipped }`; `zipPath` is `null` when nothing is archiveable, and skipped entries contain `path` and `reason`. Keep it independent of prompts, console output, and process termination.
- **`src/gitUtils.js`**: Git availability/repository checks, branch enumeration, commit resolution, NUL-delimited name-status parsing, and Target tree entries. Branch values are full refs; short names are display labels only.
- **`src/archiverUtils.js`**: ZIP naming, isolated committed-object archiving through Git, entry-set validation, and atomic no-overwrite publication. There is no `archiver` dependency.
- **`src/cliUtils.js`**: Local/Remote choice grouping, control-character-safe path formatting, and separate deletion/submodule reports.
- **`src/utils.js`**: `executeCommand` wraps `child_process.spawn` with argument arrays, binary output support, and coded errors. Use it for subprocesses; never interpolate refs or paths into shell commands.
- **`tests/`**: Bun tests and disposable Git repository fixtures covering core behavior, Git parsing, attributes, CLI reporting, archive correctness, and process execution.

## Development commands

- `bun install --frozen-lockfile`: Install dependencies without changing the lockfile.
- `bun run dev`: Run the CLI with nodemon for local iteration.
- `node index.js` or `bun index.js`: Run interactively. Agents must first read `node index.js --help`, then run `node index.js BASE TARGET` without prompts and inspect the exit code and reports; archive success is not deployment. Standalone `--version` prints the package version.
- `bun test`: Run the automated suite.
- `npm pack --dry-run`: Inspect package contents when packaging verification is requested.
- `npm pack`: Create a tarball when packaging verification is requested; install it in a disposable prefix and exercise the installed `git-diff-zip` binary.

Runtime Node.js support is exactly the `package.json` range: `>=23.5.0 || ^22.13.0 || ^20.17.0`. Git must support `rev-parse --path-format` and `--show-object-format`. Run comparisons from a Git working repository; output goes to its root. Only interactive mode requires two selectable local or remote-tracking branches. The CLI does not fetch.

## Correctness invariants

- Accept only no arguments (interactive), exactly two nonempty operands not starting with `-` (Base then Target), standalone `--help`/`-h`, or standalone `--version`. Reject everything else with `INVALID_ARGUMENTS`, a stderr help hint, and exit 1 before Git or prompts. Standalone help/version exit 0 without Git checks.
- Positional mode must skip branch enumeration and confirmation, including with piped stdin/no TTY; accept resolvable commit refs, SHAs, full refs, already-fetched remote refs, and identical refs even with one branch. Reuse `createDiffZip` and the common report/error path. Reports are human-readable stdout, errors stderr; no JSON contract or extra flags.
- Resolve Base and Target once to commit SHAs. Compare those snapshots, and archive only committed Target content. Never read archive bytes from the working tree, check out branches, require a clean tree, or stash user changes.
- Parse Git paths with NUL delimiters and preserve repository-relative paths. Use `--no-renames`: deleted old paths and added new paths are separate operations, not a rename heuristic.
- Archive changed regular files and symlinks; report Deleted Files separately. Skip changed gitlinks as submodules. Deletion-only and submodule-only runs return no ZIP but retain their reports.
- Isolate archive Git configuration and attributes from the source repository and ambient environment. Disable `export-subst` to preserve blob bytes. Validate archive entries against requested Target paths; committed `export-ignore` must fail with `ARCHIVE_MISMATCH`, not silently omit files.
- Publish a complete archive without overwriting any existing path. Collisions fail with `OUTPUT_EXISTS`; failures must leave no partial output or temporary directory.
- Keep Turkish prompt wording and Base/Target terminology consistent with `CONTEXT.md` and the existing prompts in `index.js`. Keep operational deletion and submodule lists English, separate, and control-character-safe.
- Group branches by Local/Remote and sort by ref name. Exclude symbolic refs and the selected Base from Target choices; use the current branch as default only when selectable. Preserve full-ref identity when short names overlap.
- Keep error codes stable at module boundaries. Let the CLI render terminal failures; helpers throw rather than exit.

## Style and verification

Use modern ESM JavaScript, two-space indentation, semicolons, double quotes, and `camelCase` exports. Prefer existing small modules and pure helpers over new abstractions. Tests belong in `tests/*.test.js`; share disposable repository setup through `tests/fixtures.js`.

When verification is assigned, run the suite once after all changes are integrated. For CLI changes, also exercise real Node PTY interaction: branch grouping/defaults, narrow terminals and long names, confirmation rejection, Ctrl+C, one-branch guard, no differences, deletion-only reporting, dirty Target content, and output collision. For packaging changes, verify tarball contents and installed binary behavior. Report only checks actually exercised; do not infer Windows support from macOS results. Argument-length limits and in-memory ZIP buffering remain documented constraints.

## Git and release workflow

Preserve unrelated user changes. Use Conventional Commit messages and explain user-visible effects, verification evidence, and related issues in PR descriptions. Do not commit, tag, push, or publish unless explicitly assigned.

The package is `git-diff-zip` on public npm; releases use npm Trusted Publishing (OIDC), configured as described in README's Release publishing section. Tag the publishing workflow with the release; no `NPM_TOKEN` is needed. The package's `files` list includes `index.js` and `src/`; npm also includes standard package metadata and README. Keep tests and repository guidelines out of the runtime package.
