# DiffZip: Effortlessly compare and archive your Git branch changes

DiffZip is a command-line interface (CLI) tool that simplifies the process of creating ZIP archives containing the differences between two Git branches.

This tool is especially useful for web developers working with FTP deployments, allowing them to selectively upload only the changed files without the risk of affecting unrelated modifications.

## Why DiffZip?

As a web developer, you may face the challenge of efficiently deploying changes to a server without disrupting existing configurations.

Traditional methods involve manually identifying and uploading changed files, which can be tedious and error-prone.

DiffZip takes the hassle out of the equation by automating the process, making it easy to create a ZIP archive specifically tailored to the modifications between two Git branches.

## What DiffZip Does (How It Works)

DiffZip uses Git's `git diff` command to identify and extract files that have changed between two specified branches. It then compiles these changes into a ZIP archive, providing a straightforward solution for deploying only the necessary files.

## Requirements

To use DiffZip, you need to have the following installed on your system:

- **Git:** DiffZip relies on Git to compare and extract the changed files. You can download and install Git from [here](https://git-scm.com/downloads).
- **Node.js:** DiffZip is written in JavaScript and runs on Node.js. You can download and install Node.js from [here](https://nodejs.org/en/download/).

## Get started in a snap

### Option 1: Run without Installation (Recommended)

```bash
npx git-diff-zip
```

Follow the on-screen instructions to select the branches and create the ZIP archive.

### Option 2: Install Globally

```bash
npm install -g git-diff-zip
```

After installation, run the following command in any directory:

```bash
git-diff-zip
```
