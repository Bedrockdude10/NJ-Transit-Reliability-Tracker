import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Where and how to reach the bucket. */
export interface ObjectStore {
  bucket: string;
  /** S3-compatible endpoint without a scheme, e.g. `abc.r2.cloudflarestorage.com`. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 requires the literal "auto"; MinIO and AWS want a real region. */
  region: string;
  /** MinIO over plain HTTP locally; R2 is always TLS. */
  useSsl?: boolean;
}

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

/** Just enough of the client to send a command, so tests can supply their own. */
export type ObjectWriter = Pick<S3Client, "send">;

/**
 * Store an object and confirm the bytes. `Content-MD5` makes the store rehash the
 * body it received and refuse a mismatch, which is a stronger guarantee than reading
 * the object back and costs no extra request.
 */
export async function putVerified(
  client: ObjectWriter,
  object: { bucket: string; key: string; body: Uint8Array; contentType: string },
): Promise<{ bytes: number; digest: string }> {
  const hash = createHash("md5").update(object.body).digest();
  const hex = hash.toString("hex");

  const response = await client.send(
    new PutObjectCommand({
      Bucket: object.bucket,
      Key: object.key,
      Body: object.body,
      ContentMD5: hash.toString("base64"),
      ContentType: object.contentType,
    }),
  );

  const etag = response.ETag?.replace(/"/g, "");
  if (etag && etag !== hex) {
    throw new Error(
      `object storage returned a different digest for ${object.key}: sent ${hex}, stored ${etag}`,
    );
  }
  return { bytes: object.body.byteLength, digest: hex };
}

/**
 * The store, from the four `NJT_R2_*` variables Litestream also reads. Litestream
 * wants an endpoint with a scheme and the S3 client wants a bare host, so the scheme
 * is stripped here and its presence decides TLS.
 */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set. See the Backups section of DEPLOY.md.`);
    return value;
  };

  const endpoint = required("NJT_R2_ENDPOINT");
  return {
    bucket: required("NJT_R2_BUCKET"),
    endpoint: endpoint.replace(/^https?:\/\//, ""),
    accessKeyId: required("NJT_R2_ACCESS_KEY_ID"),
    secretAccessKey: required("NJT_R2_SECRET_ACCESS_KEY"),
    region: env.NJT_R2_REGION ?? "auto",
    useSsl: !endpoint.startsWith("http://"),
  };
}
