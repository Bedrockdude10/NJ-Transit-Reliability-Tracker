import { S3Client } from "@aws-sdk/client-s3";
import type { ObjectStore } from "./object-store";

/**
 * The AWS SDK client, for the paths that still need it: reading needs `ListObjectsV2`,
 * whose response is XML. Writing does not — see `putVerified`.
 */
export function createClient(store: ObjectStore): S3Client {
  return new S3Client({
    region: store.region,
    endpoint: `${store.useSsl === false ? "http" : "https"}://${store.endpoint}`,
    credentials: { accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey },
    // R2 and MinIO both serve path-style; virtual-host style would need per-bucket DNS.
    forcePathStyle: true,
    // Recent SDK versions attach a CRC32 to every upload, and R2 rejects the pair:
    // "You can only specify one non-default checksum at a time." MinIO accepts both.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}
