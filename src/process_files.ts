import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";

import { Settings, Files, Sizes } from "@app/types";
import { DEFAULT_SIZES } from "@app/constants";
import { uploadFile } from "@app/upload_file";

export async function processFiles(files: Files, settings: Settings) {
  // Fail early if S3 is selected but not configured
  if (settings.storage === "s3" && (!settings.s3Config || !settings.s3Bucket)) {
    throw new Error(
      "Photonify: S3 storage is selected but s3Config or s3Bucket is not set.",
    );
  }

  const sizes = settings.sizes || DEFAULT_SIZES;
  const outputFormat = settings.outputFormat || "jpg";
  const outputDest =
    settings.storage === "s3"
      ? path.join(__dirname, "../tmp_for_upload")
      : settings.outputDest || "";

  const ops: any[] = [];
  const createdFiles: string[] = [];

  files.forEach((file: any) => {
    Object.keys(sizes).forEach((alias: string) => {
      const newFileName = `${uuidv4().replace(
        /-/g,
        "",
      )}-${alias}.${outputFormat}`;

      createdFiles.push(newFileName);

      ops.push(
        sharp(file)
          .resize({
            width: sizes[alias as keyof Sizes]?.width,
            height: sizes[alias as keyof Sizes]?.height,
          })
          .toFile(path.join(outputDest, newFileName))
          .then(() => {
            if (settings.storage === "s3" && process.env.NODE_ENV !== "test") {
              ops.push(
                uploadFile(
                  settings,
                  path.join(outputDest, newFileName),
                  newFileName,
                ),
              );
            }
          }),
      );
    });
  });

  try {
    await Promise.all(ops);

    return {
      createdFiles,
    };
  } catch (e) {
    console.error(e);
    throw new Error("Photonify: Error processing images");
  }
}
