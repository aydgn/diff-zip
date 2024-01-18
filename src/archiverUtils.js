import archiver from "archiver";
import { createWriteStream } from "fs";

// https://www.archiverjs.com/docs/quickstart#examples

export const createZip = (branch1, branch2, diff) => {
  // Create a new zip archive with maximum compression level.
  const archive = archiver("zip", { zlib: { level: 9 } });

  // Get the current timestamp. This will be used as part of the zip file name.
  const now = new Date().getTime();
  const output = createWriteStream(`${branch1}-${branch2}-${now}.zip`);

  // When the zip archive is ready, log the total bytes of the archive.
  output.on("close", () => {
    console.log(`✅ ${branch1}-${branch2}-${now}.zip created`);
    console.log(`✅ Total bytes: ${archive.pointer()}`);
  });

  // If an error occurs during the creation of the archive, throw the error.
  archive.on("error", err => {
    throw err;
  });

  archive.pipe(output);

  // Add each file from the diff to the zip archive.
  for (const file of diff.split("\n")) {
    archive.file(file, { name: file });
  }

  archive.finalize();
};