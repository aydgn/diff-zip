# DiffZip

DiffZip creates a **Diff Zip** containing Changed Files as committed on a **Target** ref, compared with a **Base** ref. It is useful for selective deployments, such as uploading files over FTP.

- **Base** represents what the deployment destination currently has.
- **Target** represents what the destination should match after deployment.
- **Deleted Files** are reported separately: a ZIP cannot remove files from the destination.

## Requirements

- Git on your `PATH`, with support for `git rev-parse --path-format` and `--show-object-format`.
- Node.js matching `>=23.5.0 || ^22.13.0 || ^20.17.0` (the package's engine requirement).
- Run from a Git working repository (its root or a subdirectory). Interactive mode needs at least two selectable local or remote-tracking branches; positional mode accepts resolvable commit refs even with only one local branch.
- Required commit, tree, and file-content objects must already be available locally, including through shared object stores. A partial clone that has not downloaded the required content cannot produce a ZIP; DiffZip does not fetch missing objects.
- Bun for local dependency installation and tests.

## Run locally

From this checkout:

```bash
bun install --frozen-lockfile
node index.js
node index.js main GM-12345
node index.js --help
node index.js --version
```

To compare branches in a different repository, run the entry point by absolute path from that repository's directory:

```bash
cd /path/to/deployment-repository
node /path/to/diff-zip/index.js
```

The CLI writes the ZIP to the repository root, including when invoked from a repository subdirectory. Its entries use repository-relative paths.

## Package installation

The package is **`git-diff-zip`** on public npm. Run without a global installation, from the repository to compare:

```bash
npx git-diff-zip
npx git-diff-zip main GM-12345
```

Alternatively, install globally:

```bash
npm install -g git-diff-zip
git-diff-zip
```

## Command usage

```text
git-diff-zip                 # Interactive Base/Target selection and confirmation
git-diff-zip BASE TARGET     # Non-interactive: Base first, Target second
git-diff-zip --help          # Standalone help (-h also works)
git-diff-zip --version       # Standalone package version
```

With exactly two operands, the command runs synchronously to completion without selection or confirmation prompts, including with piped stdin or no TTY. **AI coding agents and scripts must use this positional form**, not the interactive form. Both modes use the same archive logic and human-readable reports.

Base is the committed snapshot to compare **from** (typically the destination's current state); Target is the committed snapshot to compare **to**, whose bytes go into the ZIP. Operands can be local branch names, already-fetched remote-tracking refs, full refs, or commit refs such as a commit SHA or `HEAD~1`. The same ref may be used twice (no differences). Branch enumeration and the two-branch requirement apply only to interactive mode.

```bash
git-diff-zip
git-diff-zip main GM-12345
git-diff-zip origin/main origin/GM-12345
git-diff-zip refs/heads/main refs/remotes/origin/GM-12345
git-diff-zip HEAD~1 HEAD
git-diff-zip --help
git-diff-zip --version
```

`--help` (or `-h`) prints comprehensive English help to stdout and exits 0; standalone `--version` prints the package version and exits 0. Both work outside a Git repository without requiring Git. Every other flag, a single operand, three or more operands, empty operands, operands starting with `-`, and help/version mixed with operands fail with `INVALID_ARGUMENTS` and a help hint before Git checks or prompts. There are no `--yes`, `--out`, `--json`, or other extra flags.

### Interactive flow

1. Select **Base**: `Base - karşılaştırmanın başlangıç dalını seç`.
2. Select **Target**: `Target - zip'e girecek dalı seç`.
3. Confirm: `<Base> → <Target> farkı için zip oluşturulsun mu?`.

Branches are grouped under **Local** and **Remote**, with each group sorted by ref name. Remote choices are already-fetched remote-tracking refs; DiffZip does not fetch. Symbolic remote HEAD refs are excluded. The current branch is the default when available; the selected Base is excluded from Target choices. Full refs distinguish choices even when short names overlap.

Rejecting confirmation or pressing Ctrl+C aborts without creating a ZIP. Prompts are Turkish; operational results and error messages are English.

## What goes into the Diff Zip

Base and Target are resolved to commit SHA snapshots before comparison. Added, changed, and type-changed archiveable paths contain the **Target commit's bytes**, not files read from your working tree. Staged edits, unstaged edits, untracked files, your checked-out branch, and locally missing files do not supply archive contents. A dirty working tree is allowed; DiffZip does not check out branches or stash changes.

Rename detection is disabled: a rename is treated as deletion of the old path and addition of the new path. Deleted Files are never archived. Changed submodule entries are skipped because the ZIP cannot represent their contents; they appear in a separate report.

The archive operation uses an isolated bare repository sharing only Git objects, including the source's effective alternate object stores (persistent or environment-provided). Local index/worktree attributes, repository configuration, global attributes/configuration, and ambient `GIT_*` settings do not control archive behavior; only object-store locations are carried into the isolated archive. Committed `export-subst` is disabled to retain original blob bytes. If committed `export-ignore` excludes a required file, DiffZip fails with `ARCHIVE_MISMATCH` rather than producing an incomplete ZIP.

### Results and deployment

- With archiveable Changed Files, the CLI reports `[SUCCESS] Diff Zip created: <path>`.
- With no differences, it reports `[INFO] No differences found between <Base> and <Target>.` and creates no ZIP.
- With only deletions or skipped submodules, it reports `[INFO] No archivable files; no Diff Zip created.` and still prints the applicable lists.

Deletion and submodule reports are separate operational lists, not hash or rename summaries:

```text
Deleted Files (not included in Diff Zip — remove manually from destination):
  - old/page.html

Submodules skipped (zip cannot represent submodule content):
  - vendor/library
```

Paths containing control characters are quoted and escaped in reports. Review the Deleted Files and the archive entries together before deploying. Remove conflicting old files or directories **before** uploading their replacements: for example, if Base has a file named `assets` and Target has `assets/new.txt`, remove the old `assets` file first. Do not blindly apply deletion lists after uploading: a listed old file may now be a replacement directory containing newly deployed files. Remove other reported Deleted Files manually and handle skipped submodules separately. A Diff Zip is not a complete deployment or backup, and extracting it alone cannot make the destination match Target when deletions or submodules are involved.

### Output safety and limits

Names follow `<Base>-to-<Target>-YYYY-MM-DD-HHmm.zip`, using local time; `/` and `\` in branch names become `_`, and full-ref prefixes are removed. For example: `main-to-feature_checkout-2026-10-12-0930.zip`.

An existing output path fails with `OUTPUT_EXISTS`; it is never overwritten. If the generated filename exceeds 255 UTF-8 bytes, DiffZip falls back to `diff-<16-hex SHA256(Base NUL Target)>-YYYY-MM-DD-HHmm.zip` so publication succeeds on normal filesystems.

Committed paths must be valid UTF-8. Non-UTF-8 filenames are rejected with `INVALID_DIFF` instead of producing corrupted deletion reports or invalid archives.

Changed paths are passed to Git as command arguments, and the generated ZIP is buffered in memory. Very large path lists can exceed OS argument limits, and large archives can exhaust available memory. Windows behavior has not been verified.

## Agent workflow

1. Read the self-contained contract with `git-diff-zip --help`.
2. From the Git repository to compare, run two explicit refs in Base/Target order, for example `git-diff-zip main GM-12345`. Wait for the process to exit; do not answer prompts or infer completion from an early output line.
3. Inspect the exit code and stdout/stderr reports. Exit 0 may mean an archive, no changes, or a deletion/submodule-only comparison with no ZIP. Review all Deleted Files and skipped-submodule warnings before treating the comparison as handled.
4. If deploying separately, review the ZIP's reported path and arrange manual destination deletions and separate submodule handling as needed. Successful archive creation **does not mean deployment happened**.

### Exit codes and streams

- **0:** successful archive creation, no differences, no archiveable files (including deletion-only/submodule-only results), interactive cancellation, standalone help, or standalone version.
- **1:** invalid arguments, Git availability/repository failures, ref resolution failures, or archive failures (including output collisions).
- **130:** SIGINT interruption during active archive creation, after child-process and temporary-file cleanup.
- **143:** SIGTERM interruption during active archive creation, after child-process and temporary-file cleanup.

Stdout contains human-readable operational reports, help, and version output; stderr contains errors. There is no JSON or machine-readable output contract. DiffZip does not fetch, check out refs, stash changes, deploy files, or automatically delete destination files.

Cancellation before publication creates no ZIP. Atomic publication of a complete ZIP is the commit boundary: cancellation never removes an already-published archive.

## Development

```bash
bun test
```

The automated suite is in `tests/` and uses disposable Git repositories. See [AGENTS.md](AGENTS.md) for module boundaries and contributor invariants, and [changelog.md](changelog.md) for version history.
