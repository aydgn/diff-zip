#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import confirm from "@inquirer/confirm";
import select from "@inquirer/select";
import { checkGitInstalled, checkGitRepo, getBranches } from "./src/gitUtils.js";
import { createDiffZip } from "./src/core.js";
import { buildBranchChoices, formatReportPath, printDiffReport } from "./src/cliUtils.js";

const BASE_LABEL = "\x1b[1m\x1b[36mBase\x1b[0m";
const TARGET_LABEL = "\x1b[1m\x1b[35mTarget\x1b[0m";

const HELP = `git-diff-zip — archive committed changes from Base to Target

Usage:
  git-diff-zip
  git-diff-zip BASE TARGET
  git-diff-zip --help
  git-diff-zip -h
  git-diff-zip --version

Modes and arguments:
  No arguments: interactively select Base and Target branches, then confirm.
  Two arguments: Base first, Target second; runs to completion without selection
  or confirmation prompts, including with piped stdin or no TTY. AI coding
  agents must use this explicit two-ref mode, not the interactive mode.
  BASE is the comparison starting point (the existing state).
  TARGET is the new state whose added/modified committed files enter the ZIP.
  Both accept local branches, already-fetched remote branches (origin/main),
  full refs (refs/heads/main, refs/remotes/origin/main), and commit refs such as
  HEAD, HEAD~1, tags, or commit SHAs. The same ref is allowed for both operands.
  Operands must be nonempty and must not start with "-". Exactly two are required.
  Only standalone --help, -h, and --version are supported flags. No --yes, --out,
  --json, or other flags; do not combine flags with operands.

Requirements and output:
  Node.js engine: >=23.5.0 || ^22.13.0 || ^20.17.0; Git must be on PATH.
  Git must support rev-parse --path-format and --show-object-format.
  Run archive commands inside a Git repository (including a subdirectory).
  --help, -h, and --version work outside Git and without Git installed.
  The ZIP is written to the repository root as
  BASE-to-TARGET-YYYY-MM-DD-HHMM.zip (local time, minute precision).
  refs/heads/ and refs/remotes/ prefixes are removed from filename operands;
  slashes and backslashes become underscores. Existing output is never
  overwritten: repeating the same pair in the same minute can fail OUTPUT_EXISTS.
  Names exceeding 255 UTF-8 bytes use diff-<16hex SHA256(BASE NUL TARGET)>-
  YYYY-MM-DD-HHMM.zip instead; ordinary output names are unchanged.
  Committed paths must be valid UTF-8; invalid byte sequences are rejected.
  ZIP bytes come from the committed Target, not dirty/untracked working files.
  Original committed snapshots are archived: export-subst is disabled.
  Repository/worktree attribute overrides are ignored; committed export-ignore
  remains effective and fails ARCHIVE_MISMATCH if changed files are omitted.
  There is no fetch, checkout, stash, deployment, or automatic deletion of
  repository/deployment files. Required committed objects and file content
  must already be local; shared object stores are supported. Remote refs
  must already exist locally.
  Deleted paths are reported for manual removal; renames are deletion + addition.
  Changed submodules are skipped and reported; their contents are not archived.
  No differences or deletion-only changes succeed without creating a ZIP;
  applicable deletion/submodule reports are still printed.
  Reports are human-readable stdout; errors are stderr. There is no JSON contract.
  Errors include the stable top-level code followed by original cause diagnostics;
  control characters in diagnostics are escaped.
  During active archive creation, SIGINT/SIGTERM cancel and await temporary-file
  and child-process cleanup. Cancellation before publication creates no ZIP;
  a fully published ZIP is the commit boundary and is never removed.

Exit codes:
  0  Success, interactive cancellation, or no archivable changes.
  1  Invalid arguments, Git/repository/ref errors, or archive/output failure.
  130  SIGINT interruption during active archive creation, after cleanup.
  143  SIGTERM interruption during active archive creation, after cleanup.

Examples:
  git-diff-zip
  git-diff-zip main GM-12345
  git-diff-zip origin/main origin/GM-12345
  git-diff-zip refs/heads/main refs/remotes/origin/GM-12345
  git-diff-zip HEAD~1 HEAD
  git-diff-zip --help
  git-diff-zip --version

Agent workflow:
  First run git-diff-zip --help. Then run git-diff-zip BASE TARGET with explicit
  refs, wait for completion, and inspect the exit code and reports. Review
  deletion and skipped-submodule warnings. Remove conflicting old files/dirs
  from the destination BEFORE installing Target replacements. Never blindly
  delete replacement directories afterwards. Success means archived, not deployed.`;

const main = async () => {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      console.log(HELP);
      return;
    }
    if (args.length === 1 && args[0] === "--version") {
      const { version } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
      console.log(version);
      return;
    }
    if (args.length !== 0 && (args.length !== 2 || args.some(arg => !arg || arg.startsWith("-")))) {
      console.error("[FAIL] INVALID_ARGUMENTS: Expected no arguments or BASE TARGET. Run git-diff-zip --help for usage.");
      process.exitCode = 1;
      return;
    }

    await checkGitInstalled(process.cwd());
    const cwd = await checkGitRepo(process.cwd());
    let [base, target] = args;
    let baseName = base;
    let targetName = target;
    if (args.length === 0) {
      const branches = await getBranches(cwd);
      const selectable = [...branches.local, ...branches.remote];
      if (selectable.length < 2) {
        console.error("[FAIL] Need at least two selectable local or remote branches to compare.");
        process.exitCode = 1;
        return;
      }

      const currentAvailable = selectable.some(branch => branch.ref === branches.current);
      base = await select({
        message: `${BASE_LABEL} — karşılaştırmanın başlangıç dalını seç`,
        choices: buildBranchChoices(branches, "karşılaştırmanın temeli — sunucudaki mevcut hal"),
        ...(currentAvailable ? { default: branches.current } : {}),
      });
      target = await select({
        message: `${TARGET_LABEL} — zip'e girecek dalı seç`,
        choices: buildBranchChoices(branches, "zip'e girecek yeni hal", base),
        ...(currentAvailable && branches.current !== base ? { default: branches.current } : {}),
      });
      baseName = selectable.find(branch => branch.ref === base).name;
      targetName = selectable.find(branch => branch.ref === target).name;
      const proceed = await confirm({
        message: `${baseName} → ${targetName} farkı için zip oluşturulsun mu?`,
        default: true,
      });
      if (!proceed) {
        console.log("[INFO] Aborted by user.");
        return;
      }
    }

    const controller = new AbortController();
    let interruption;
    const onInterrupt = () => {
      if (interruption) return;
      interruption = "SIGINT";
      controller.abort();
    };
    const onTerminate = () => {
      if (interruption) return;
      interruption = "SIGTERM";
      controller.abort();
    };
    let result;
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    try {
      result = await createDiffZip({ base, target, cwd, signal: controller.signal });
    } catch (error) {
      if (!interruption || error !== controller.signal.reason) throw error;
      console.error(`[INFO] Cancelled by ${interruption}; cleanup complete.`);
      process.exitCode = interruption === "SIGINT" ? 130 : 143;
      return;
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    }
    if (result.zipPath) {
      console.log(`[SUCCESS] Diff Zip created: ${formatReportPath(result.zipPath)}`);
    } else if (result.deleted.length === 0 && result.skipped.length === 0) {
      console.log(`[INFO] No differences found between ${formatReportPath(baseName)} and ${formatReportPath(targetName)}.`);
    } else {
      console.log("[INFO] No archivable files; no Diff Zip created.");
    }
    printDiffReport(result);
  } catch (error) {
    if (error?.name === "ExitPromptError" || error?.name === "AbortPromptError") {
      console.log("[INFO] Aborted by user.");
      return;
    }
    console.error(`[FAIL] ${formatReportPath(`${error.code ? `${error.code}: ` : ""}${error.message}`)}`);
    const seen = new Set([error]);
    for (let cause = error.cause; cause && !seen.has(cause); cause = cause.cause) {
      seen.add(cause);
      console.error(`[CAUSE] ${formatReportPath(`${cause.code ? `${cause.code}: ` : ""}${cause.message ?? String(cause)}`)}`);
    }
    process.exitCode = 1;
  }
};

main();
