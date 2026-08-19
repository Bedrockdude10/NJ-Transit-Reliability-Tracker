import { createHash, createHmac } from "node:crypto";

const URL_SCHEME_RE = /^https?:\/\//u;
const QUOTES_RE = /"/gu;
const AMZ_DATE_RE = /[-:]|\.\d{3}/gu;

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

/** Just enough of `fetch` to send one request, so tests can supply their own. */
export type ObjectWriter = typeof fetch;

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Uint8Array | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

export interface PutObject {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}

/**
 * Headers for one signed PUT. See README "Object storage".
 *
 * Path-style and single-encoded, which is what S3 signs and what R2 serves;
 * `test/sigv4.test.ts` pins this against the AWS SDK's own signer.
 */
export function signedPutHeaders(
  store: ObjectStore,
  object: PutObject,
  contentMd5: string,
  now: Date,
): Record<string, string> {
  const amzDate = now.toISOString().replace(AMZ_DATE_RE, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(object.body);

  const signed: Record<string, string> = {
    "content-md5": contentMd5,
    "content-type": object.contentType,
    host: store.endpoint,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(signed).sort();
  const canonical = [
    "PUT",
    `/${object.bucket}/${object.key}`,
    "",
    names.map((name) => `${name}:${signed[name]?.trim() ?? ""}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${store.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(
    hmac(hmac(`AWS4${store.secretAccessKey}`, dateStamp), store.region),
    "s3",
  );
  const signature = createHmac("sha256", hmac(key, "aws4_request"))
    .update(toSign)
    .digest("hex");

  return {
    ...signed,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${store.accessKeyId}/${scope}, ` +
      `SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/** Where a path-style request for this object goes. */
export function objectUrl(store: ObjectStore, object: Pick<PutObject, "bucket" | "key">): string {
  return `${store.useSsl === false ? "http" : "https"}://${store.endpoint}/${object.bucket}/${object.key}`;
}

/**
 * Store an object and confirm the bytes. `Content-MD5` makes the store rehash the
 * body it received and refuse a mismatch, which is a stronger guarantee than reading
 * the object back and costs no extra request.
 *
 * Signed `fetch` rather than the AWS SDK: importing the SDK costs 23 MB of the
 * machine's 512, to issue a request this file describes in full.
 */
export async function putVerified(
  store: ObjectStore,
  object: PutObject,
  send: ObjectWriter = fetch,
): Promise<{ bytes: number; digest: string }> {
  const hash = createHash("md5").update(object.body).digest();
  const hex = hash.toString("hex");
  const headers = signedPutHeaders(store, object, hash.toString("base64"), new Date());

  // `host` is signed but cannot be set on a fetch: the runtime owns it, and sets
  // exactly the endpoint the URL names.
  const { host: _host, ...sendable } = headers;
  const response = await send(objectUrl(store, object), {
    method: "PUT",
    headers: sendable,
    // Re-viewed over its own buffer: `BodyInit` wants a view backed by an
    // `ArrayBuffer`, and a Node `Buffer` is typed over `ArrayBufferLike`.
    body: new Uint8Array(object.body.buffer as ArrayBuffer, object.body.byteOffset, object.body.byteLength),
  });

  if (!response.ok) {
    throw new Error(
      `object storage refused ${object.key}: ${response.status} ${await response.text()}`,
    );
  }

  const etag = response.headers.get("etag")?.replace(QUOTES_RE, "");
  if (etag && etag !== hex) {
    throw new Error(
      `object storage returned a different digest for ${object.key}: sent ${hex}, stored ${etag}`,
    );
  }
  return { bytes: object.body.byteLength, digest: hex };
}

/**
 * The store, from the four `NJT_R2_*` variables Litestream also reads. Litestream
 * wants an endpoint with a scheme and a signed request wants a bare host, so the
 * scheme is stripped here and its presence decides TLS.
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
    endpoint: endpoint.replace(URL_SCHEME_RE, ""),
    accessKeyId: required("NJT_R2_ACCESS_KEY_ID"),
    secretAccessKey: required("NJT_R2_SECRET_ACCESS_KEY"),
    region: env.NJT_R2_REGION ?? "auto",
    useSsl: !endpoint.startsWith("http://"),
  };
}
