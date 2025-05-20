import archiver from "archiver";
import { createWriteStream } from "fs";

// https://www.archiverjs.com/docs/quickstart#examples

export const createZip = (branch1, branch2, diff) => {
  // This function returns a Promise that resolves with the zip file name upon successful creation,
  // or rejects if an error occurs during the process.
  return new Promise((resolve, reject) => {
    // Initialize archiver with 'zip' format and set compression level to maximum (9).
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Generate a unique zip file name using branch names and the current timestamp.
    const now = new Date().getTime();
    // Sanitize branch names for use in the filename
    const [sanitizedBranch1, sanitizedBranch2] = [branch1, branch2].map(name => name.replace(/\//g, "_"));
    const zipFileName = `${sanitizedBranch1}-${sanitizedBranch2}-${now}.zip`;
    // Create a writable stream to the output zip file.
    const output = createWriteStream(zipFileName);

    // Event listener for when the output stream has finished writing all data.
    // This signifies that the zip file has been successfully created.
    output.on("close", () => {
      console.log(`✅ ${zipFileName} created`);
      console.log(`✅ Total bytes: ${archive.pointer()}`); // Logs the total size of the archive.
      resolve(zipFileName); // Resolve the promise with the name of the created zip file.
    });

    // Event listener for errors on the archiver instance.
    // If an error occurs during archiving (e.g., issues with adding files), reject the promise.
    archive.on("error", err => {
      reject(err);
    });

    // Event listener for errors on the output stream.
    // If an error occurs while writing to the file (e.g., disk full), reject the promise.
    output.on("error", err => {
      reject(err);
    });

    // Event listener for warnings from the archiver.
    // Specifically handles 'ENOENT' (file not found) warnings by logging them.
    // Other warnings will cause the promise to reject.
    archive.on("warning", err => {
      if (err.code === "ENOENT") {
        console.warn(`⚠️ Warning (ENOENT): ${err.message} - This file will be skipped.`);
      } else {
        reject(err); // For other warnings, treat them as errors.
      }
    });

    // Pipe the archive data to the output file stream.
    archive.pipe(output);

    // The 'diff' parameter is an array of filenames.
    // Filter out any empty strings from the list of files to prevent errors.
    const filesToArchive = diff.filter(fileName => fileName && fileName.trim() !== "");

    // Iterate over the valid file names and add each one to the archive.
    // The 'name' option in archive.file() specifies the path of the file within the zip.
    for (const file of filesToArchive) {
      archive.file(file, { name: file });
    }

    // Finalize the archive. This closes the archive and writes any remaining data.
    // No more files can be added after this point.
    archive.finalize();
  });
};
