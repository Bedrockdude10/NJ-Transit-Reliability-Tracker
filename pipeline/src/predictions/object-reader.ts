import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createClient, type ObjectStore } from "../archive/object-store";
import type { ObjectReader } from "./import-jsonl";

/** Reads object storage through the S3 client, for the CLI. */
export function s3Reader(store: ObjectStore, client: S3Client = createClient(store)): ObjectReader {
  return {
    list: async (prefix) => {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: store.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = page.NextContinuationToken;
      } while (token);
      return keys;
    },
    get: async (key) => {
      const object = await client.send(
        new GetObjectCommand({ Bucket: store.bucket, Key: key }),
      );
      const body = object.Body;
      if (body === undefined) throw new Error(`object ${key} has no body`);
      return body.transformToByteArray();
    },
  };
}
