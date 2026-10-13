# DiffZip

DiffZip creates a **Diff Zip** containing Changed Files as committed on a **Target** ref, compared with a **Base** ref. It is useful for selective deployments, such as uploading files over FTP.

- **Base** represents what the deployment destination currently has.
- **Target** represents what the destination should match after deployment.
- **Deleted Files** are reported separately: a ZIP cannot remove files from the destination.

## Installation

Run without installing, from the Git repository to compare:

```bash
npx git-diff-zip
npx git-diff-zip main GM-12345
```

Or install globally:

```bash
npm install -g git-diff-zip
git-diff-zip
```

### Requirements

- Node.js `>=23.5.0 || ^22.13.0 || ^20.17.0`.
- Git on your `PATH`, with support for `git rev-parse --path-format` and `--show-object-format`.
- A Git working repository (run from its root or any subdirectory). Interactive mode needs at least two selectable local or remote-tracking branches; positional mode accepts any resolvable commit refs, even with one local branch.
- The compared commits and their file contents must already be available locally, including through shared object stores. DiffZip never fetches: remote refs must already be fetched, and a partial clone that lacks the required file contents cannot produce a ZIP.

## Usage

```text
git-diff-zip                 # Interactive Base/Target selection and confirmation
git-diff-zip BASE TARGET     # Non-interactive: Base first, Target second
git-diff-zip --help          # Standalone help (-h also works)
git-diff-zip --version       # Standalone package version
```

Base is the committed snapshot to compare **from** (typically the destination's current state); Target is the committed snapshot to compare **to**, whose bytes go into the ZIP. Operands can be local branches, already-fetched remote-tracking refs, full refs, or any commit ref such as a SHA or `HEAD~1`. The same ref may be used twice (no differences).

```bash
git-diff-zip main GM-12345
git-diff-zip origin/main origin/GM-12345
git-diff-zip refs/heads/main refs/remotes/origin/GM-12345
git-diff-zip HEAD~1 HEAD
```

With exactly two operands the command runs to completion without selection or confirmation prompts, including with piped stdin or no TTY. **Scripts and AI coding agents must use this positional form.** Agents should read `git-diff-zip --help` first, wait for the process to exit, then inspect the exit code and reports; exit 0 can mean no ZIP was created, and a created ZIP does not mean anything was deployed.

`--help` and `--version` print to stdout and exit 0, and work outside a Git repository. They must stand alone. Any other flag, an operand count other than zero or two, an empty operand, or an operand starting with `-` fails with `INVALID_ARGUMENTS` and a help hint before Git checks or prompts. There are no `--yes`, `--out`, `--json`, or other extra flags.

The ZIP is written to the repository root, even when invoked from a subdirectory. Its entries use repository-relative paths.

### Interactive mode

1. Select **Base**: `Base - karşılaştırmanın başlangıç dalını seç`.
2. Select **Target**: `Target - zip'e girecek dalı seç`.
3. Confirm: `<Base> → <Target> farkı için zip oluşturulsun mu?`.

Branches are grouped under **Local** and **Remote**, each sorted by ref name. Symbolic remote HEAD refs are excluded; the current branch is the default when available, and the selected Base is excluded from Target choices. Full refs keep choices distinct even when short names overlap.

Rejecting confirmation or pressing Ctrl+C aborts without creating a ZIP. Prompts are Turkish; reports and error messages are English.

## What goes into the Diff Zip

Base and Target are resolved to commit SHAs before comparison. Added, changed, and type-changed files contain the **Target commit's bytes**, never files read from your working tree: staged or unstaged edits, untracked files, the checked-out branch, and locally missing files do not affect the archive. A dirty working tree is allowed; DiffZip does not check out branches or stash changes.

Rename detection is disabled: a rename is a deletion of the old path plus an addition of the new path. Deleted Files are never archived. Changed submodules are skipped because a ZIP cannot represent them, and are reported separately.

Repository configuration, local attributes, and `GIT_*` environment settings cannot alter the archive, and `export-subst` is not expanded. If a committed `export-ignore` would omit a changed file, DiffZip fails with `ARCHIVE_MISMATCH` instead of producing an incomplete ZIP.

### Results and deployment

- With archiveable Changed Files: `[SUCCESS] Diff Zip created: <path>`.
- With no differences: `[INFO] No differences found between <Base> and <Target>.` and no ZIP.
- With only deletions or skipped submodules: `[INFO] No archivable files; no Diff Zip created.` followed by the applicable lists.

Deletions and submodules are reported as separate lists:

```text
Deleted Files (not included in Diff Zip — remove manually from destination):
  - old/page.html

Submodules skipped (zip cannot represent submodule content):
  - vendor/library
```

Paths containing control characters are quoted and escaped in reports.

A Diff Zip is not a complete deployment or backup; extracting it alone cannot make the destination match Target when deletions or submodules are involved. Review the Deleted Files and the archive entries together before deploying, and remove conflicting old files or directories **before** uploading their replacements. For example, if Base has a file `assets` and Target has `assets/new.txt`, remove the old `assets` file first. Do not blindly apply deletion lists after uploading: a listed old path may now be a replacement directory containing newly deployed files. Handle skipped submodules separately.

### Output names and limits

ZIP names follow `<Base>-to-<Target>-YYYY-MM-DD-HHmm.zip` in local time; `/` and `\` in ref names become `_`, and `refs/heads/` or `refs/remotes/` prefixes are removed, for example `main-to-feature_checkout-2026-10-12-0930.zip`. Names over 255 UTF-8 bytes fall back to `diff-<16-hex hash>-YYYY-MM-DD-HHmm.zip`.

An existing output path is never overwritten: it fails with `OUTPUT_EXISTS`, so repeating the same pair within the same minute can fail. Committed paths must be valid UTF-8; other filenames are rejected with `INVALID_DIFF`.

Changed paths are passed to Git as command arguments and the ZIP is buffered in memory, so very large path lists can exceed OS argument limits and very large archives can exhaust memory. Windows behavior has not been verified.

## Exit codes and streams

- **0:** archive created, no differences, no archiveable files (including deletion-only or submodule-only results), interactive cancellation, `--help`, or `--version`.
- **1:** invalid arguments, Git or repository failures, ref resolution failures, or archive failures (including output collisions).
- **130:** SIGINT during active archive creation, after cleanup.
- **143:** SIGTERM during active archive creation, after cleanup.

Cancellation before publication creates no ZIP; a ZIP that was already fully published is never removed.

Stdout contains reports, help, and version output; stderr contains errors. There is no JSON or machine-readable output contract. DiffZip does not deploy files or delete anything from the destination.

## Contributing

Development setup, module boundaries, and the release process are in [AGENTS.md](AGENTS.md). Version history is in [changelog.md](changelog.md).
