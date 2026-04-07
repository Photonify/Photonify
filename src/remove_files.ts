import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

import { Settings } from "@app/types";

export async function removeFiles(
  fileNames: string[],
  settings: Partial<Settings>,
) {
  if (settings.storage !== "s3" || !settings.s3Config || !settings.s3Bucket) {
    throw new Error(
      "Photonify: Storage must be set to S3 and have s3Config and s3Bucket configured.",
    );
  }

  if (process.env.NODE_ENV === "test") {
    return;
  }

  const client = new S3Client(settings.s3Config);

  const deleteObjects = fileNames.map((fileName) => {
    return {
      Key: fileName,
    };
  });

  const command = new DeleteObjectsCommand({
    Bucket: settings.s3Bucket,
    Delete: {
      Objects: deleteObjects,
    },
  });

  try {
    await client.send(command);

    fileNames.forEach((fileName) => {
      console.log(`Photonify S3 Delete: ${fileName}`);
    });
  } catch (e) {
    console.error(e);
    throw new Error("Photonify: S3 delete error");
  }
}
