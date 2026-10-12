# git-diff-zip

CLI tool that packages the difference between two git branches as a deployable ZIP archive, for selectively uploading only changed files (e.g. over FTP).

## Language

**Base**:
The branch representing what the deployment destination currently has; the reference point a comparison starts from.
_Avoid_: source branch, from-branch, branch1

**Target**:
The branch the destination should end up matching once the archive is applied.
_Avoid_: destination branch, to-branch, branch2

**Diff Zip**:
The archive produced by a run: every Changed File's content as committed on Target. Fully determined by Base and Target — the local working tree plays no part.
_Avoid_: diff archive, export, package

**Changed File**:
A file whose committed content differs between Base and Target.
_Avoid_: modified file, diff file

**Deleted File**:
A file present on Base but absent on Target. Never included in the Diff Zip (an archive cannot express removal); reported on the console so the destination can be cleaned up manually.
_Avoid_: removed file, missing file
