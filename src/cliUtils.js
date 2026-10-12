import { Separator } from "@inquirer/prompts";

export const buildBranchChoices = ({ local, remote }, description, excludedRef) => {
  const choices = [];
  for (const [label, branches] of [["Local", local], ["Remote", remote]]) {
    const selectable = branches.filter(branch => branch.ref !== excludedRef);
    if (selectable.length === 0) continue;
    choices.push(new Separator(`── ${label} ──`));
    choices.push(...selectable.map(branch => ({
      name: branch.name,
      value: branch.ref,
      description,
    })));
  }
  return choices;
};

export const formatReportPath = path => {
  if (!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(path)) return path;
  return JSON.stringify(path).replace(/[\u007f-\u009f\u2028\u2029]/gu, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
};

export const printDiffReport = ({ deleted, skipped }, log = console.log) => {
  if (deleted.length > 0) {
    log("Deleted Files (not included in Diff Zip — remove manually from destination):");
    for (const path of deleted) log(`  - ${formatReportPath(path)}`);
  }
  if (skipped.length > 0) {
    if (deleted.length > 0) log("");
    log("Submodules skipped (zip cannot represent submodule content):");
    for (const { path } of skipped) log(`  - ${formatReportPath(path)}`);
  }
};
