import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createClient, type ObjectStore } from "../archive/object-store";
import type { ObjectReader } from "./import-jsonl";

const QUOTES_RE = /"/gu;

/** Reads object storage through the S3 client, for the CLI. */
export function s3Reader(store: ObjectStore, client: S3Client = createClient(store)): ObjectReader {
  return {
    list: async (prefix) => {
      const listed: { key: string; etag: string | null }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: store.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) {
          // Returned by the listing itself, so knowing whether a partition moved
          // costs no request of its own.
          if (object.Key) {
            listed.push({ key: object.Key, etag: object.ETag?.replace(QUOTES_RE, "") ?? null });
          }
        }
        token = page.NextContinuationToken;
      } while (token);
      return listed;
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
