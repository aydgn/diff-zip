#!/usr/bin/env node
// Prototype for wayfinder ticket 8: the Base -> Target branch selection flow.
// Standalone — imports only @inquirer/prompts + node builtins, nothing from
// src/, so this file can be deleted freely once the human ruling lands.
//
// Interactive:      node prototypes/prompt-flow.mjs
// Data-only (no TTY needed): node prototypes/prompt-flow.mjs --data-only

import { execFileSync } from "node:child_process";
import { select, confirm, Separator } from "@inquirer/prompts";

// --- styling ---------------------------------------------------------------
// @inquirer's `theme.style.message` transform receives the WHOLE message
// string, so it can't bold just the "Base"/"Target" word inside a longer
// sentence — there's no per-substring hook in v8's theme API. Raw ANSI
// escapes are used for that inline emphasis instead. `theme.style` itself
// IS exercised below (see roleTheme) for whole-element styling: the
// highlighted choice and the description line color.
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_MAGENTA = "\x1b[35m";
const ANSI_RESET = "\x1b[0m";
const boldColor = (text, color) => `${ANSI_BOLD}${color}${text}${ANSI_RESET}`;

const BASE_LABEL = boldColor("Base", ANSI_CYAN);
const TARGET_LABEL = boldColor("Target", ANSI_MAGENTA);

const BASE_DESCRIPTION = "karşılaştırmanın temeli — sunucudaki mevcut hal";
const TARGET_DESCRIPTION = "zip'e girecek yeni hal";

// --- git data ----------------------------------------------------------

const runGit = args => execFileSync("git", args, { encoding: "utf8" }).trim();

// Single for-each-ref call across both namespaces, per the ticket. The long
// `%(refname)` is used to sort local vs. remote; `%(symref)` is used to drop
// the `origin/HEAD` alias. Verified against this repo (git 2.55): that ref's
// *short* name (`%(refname:short)`) prints as the bare string "origin", not
// "origin/HEAD" — so filtering on name shape would be fragile and
// version-dependent. Filtering on a non-empty `%(symref)` instead reliably
// drops any symbolic ref regardless of how its short name renders.
const FOR_EACH_REF_FORMAT = "%(refname)%09%(refname:short)%09%(symref)";

const gatherBranchData = () => {
  const raw = runGit(["for-each-ref", `--format=${FOR_EACH_REF_FORMAT}`, "refs/heads", "refs/remotes"]);
  const current = runGit(["branch", "--show-current"]);

  const local = [];
  const remote = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [refname, shortName, symref] = line.split("\t");
    if (symref) continue; // drop symbolic refs, e.g. origin/HEAD -> origin/main
    if (refname.startsWith("refs/heads/")) local.push(shortName);
    else if (refname.startsWith("refs/remotes/")) remote.push(shortName);
  }

  return { current, local, remote };
};

// --- prompt flow -------------------------------------------------------

const toChoices = (branches, description) =>
  branches.map(branch => ({ name: branch, value: branch, description }));

const buildGroupedChoices = ({ local, remote }, description) => [
  new Separator("── Local ──"),
  ...toChoices(local, description),
  new Separator("── Remote ──"),
  ...toChoices(remote, description),
];

// Exercises the ticket's "is theme.style customization enough?" question:
// yes, for whole-element styling (the highlighted choice, the description
// line under it) — but see the ANSI_* note above for what it can't do.
const roleTheme = color => ({
  style: {
    highlight: text => boldColor(text, color),
    description: text => `${color}${text}${ANSI_RESET}`,
  },
});

const runInteractiveFlow = async data => {
  const base = await select({
    message: `${BASE_LABEL} — karşılaştırmanın başlangıç dalını seç`,
    choices: buildGroupedChoices(data, BASE_DESCRIPTION),
    default: data.current,
    theme: roleTheme(ANSI_CYAN),
  });

  const remainingLocal = data.local.filter(branch => branch !== base);
  const remainingRemote = data.remote.filter(branch => branch !== base);

  // v8 `select`'s `default` takes a `value` and ONLY controls where the
  // cursor starts on first render — it does not pre-answer the prompt (the
  // human still has to press Enter). Confirmed against
  // node_modules/@inquirer/select README. If the current branch was chosen
  // as Base, there's nothing sensible left to preselect for Target, so
  // `default` is omitted and the cursor falls back to the first selectable
  // choice (top of Local).
  const target = await select({
    message: `${TARGET_LABEL} — zip'e girecek dalı seç`,
    choices: [
      new Separator("── Local ──"),
      ...toChoices(remainingLocal, TARGET_DESCRIPTION),
      new Separator("── Remote ──"),
      ...toChoices(remainingRemote, TARGET_DESCRIPTION),
    ],
    ...(data.current !== base ? { default: data.current } : {}),
    theme: roleTheme(ANSI_MAGENTA),
  });

  // TEST NOTE (wrapping): none of this repo's real branches are long enough
  // to test terminal wrapping. To check the confirm line's behaviour with a
  // long remote name, temporarily substitute `target` below with something
  // like "origin/feature/this-is-a-deliberately-long-branch-name-to-check-how-the-confirm-line-wraps"
  // and re-run in a narrow (e.g. 80-column) terminal.
  const proceed = await confirm({
    message: `${base} → ${target} fark için zip oluşturulsun mu?`,
    default: true,
  });

  console.log(proceed ? "-> devam ediliyor" : "-> iptal edildi");
};

// --- entry point ---------------------------------------------------------

const data = gatherBranchData();

// Guard the interactive part behind a TTY check (so this is smoke-checkable
// in CI/non-interactive shells) or an explicit --data-only flag.
const dataOnly = process.argv.includes("--data-only") || !process.stdout.isTTY;

if (dataOnly) {
  console.log(JSON.stringify(data, null, 2));
} else {
  await runInteractiveFlow(data);
}
