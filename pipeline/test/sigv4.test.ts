import { createHash, createHmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { describe, expect, it } from "vitest";
import {
  objectUrl,
  type ObjectStore,
  putVerified,
  signedPutHeaders,
} from "../src/archive/object-store";

/**
 * Signing is the one thing here that cannot be checked by reading it: a wrong
 * signature is indistinguishable from a right one until the store rejects it. So it
 * is pinned against the AWS SDK's own signer on the identical request. If these ever
 * disagree, the hand-written one is wrong.
 */

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "abc123.r2.cloudflarestorage.com",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "auto",
};

/** `node:crypto` behind the hash interface smithy expects. */
class NodeSha256 {
  private readonly hash;
  constructor(secret?: Uint8Array | string) {
    this.hash = secret === undefined ? createHash("sha256") : createHmac("sha256", secret);
  }
  update(data: Uint8Array | string): void {
    this.hash.update(data);
  }
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.hash.digest());
  }
}

async function sdkAuthorization(
  object: { bucket: string; key: string; body: Uint8Array; contentType: string },
  contentMd5: string,
  now: Date,
): Promise<string> {
  const signer = new SignatureV4({
    service: "s3",
    region: STORE.region,
    credentials: { accessKeyId: STORE.accessKeyId, secretAccessKey: STORE.secretAccessKey },
    sha256: NodeSha256 as never,
    uriEscapePath: false,
    applyChecksum: false,
  });
  const signed = await signer.sign(
    {
      method: "PUT",
      protocol: "https:",
      hostname: STORE.endpoint,
      path: new URL(objectUrl(STORE, object)).pathname,
      headers: {
        host: STORE.endpoint,
        "content-md5": contentMd5,
        "content-type": object.contentType,
        "x-amz-content-sha256": createHash("sha256").update(object.body).digest("hex"),
        "x-amz-date": now.toISOString().replace(/[-:]|\.\d{3}/gu, ""),
      },
      body: object.body,
      query: {},
    },
    { signingDate: now },
  );
  const header = signed.headers.authorization ?? signed.headers.Authorization;
  if (header === undefined) throw new Error("the SDK signed nothing");
  return header;
}

function put(key: string, body: Uint8Array) {
  return { bucket: STORE.bucket, key, body, contentType: "application/gzip" };
}

const NOW = new Date("2026-08-19T18:00:00Z");
const md5 = (body: Uint8Array) => createHash("md5").update(body).digest("base64");

describe("the signature this repo writes by hand", () => {
  it("matches the AWS SDK's, byte for byte, on a real partition key", async () => {
    const object = put(
      "events/service_date=2026-08-19/events.jsonl.gz",
      Buffer.from("gzipped bytes"),
    );
    expect(signedPutHeaders(STORE, object, md5(object.body), NOW).authorization).toBe(
      await sdkAuthorization(object, md5(object.body), NOW),
    );
  });

  it("matches on a key with no `=` in it, so the partition form is not load-bearing", async () => {
    const object = put("contract/v1/manifest.json", Buffer.from("{}"));
    expect(signedPutHeaders(STORE, object, md5(object.body), NOW).authorization).toBe(
      await sdkAuthorization(object, md5(object.body), NOW),
    );
  });

  it("matches on an empty body, which hashes to the well-known empty digest", async () => {
    const object = put("events/service_date=2026-08-19/events.jsonl.gz", new Uint8Array());
    expect(signedPutHeaders(STORE, object, md5(object.body), NOW).authorization).toBe(
      await sdkAuthorization(object, md5(object.body), NOW),
    );
  });

  it("signs a different body to a different signature", () => {
    const one = put("k", Buffer.from("a"));
    const two = put("k", Buffer.from("b"));
    expect(signedPutHeaders(STORE, one, md5(one.body), NOW).authorization).not.toBe(
      signedPutHeaders(STORE, two, md5(two.body), NOW).authorization,
    );
  });

  it("signs the same request differently a second later, so a replay is bounded", () => {
    const object = put("k", Buffer.from("a"));
    const later = new Date(NOW.getTime() + 1000);
    expect(signedPutHeaders(STORE, object, md5(object.body), NOW).authorization).not.toBe(
      signedPutHeaders(STORE, object, md5(object.body), later).authorization,
    );
  });
});

describe("what the request looks like on the wire", () => {
  it("percent-encodes `=`, because the store re-encodes the path before checking", () => {
    // R2 answered 403 on `service_date=2026-08-18` and quoted back a canonical
    // request reading `service_date%3D2026-08-18`.
    expect(objectUrl(STORE, { bucket: "njt-archive", key: "events/service_date=2026-08-18/e.gz" })).toBe(
      "https://abc123.r2.cloudflarestorage.com/njt-archive/events/service_date%3D2026-08-18/e.gz",
    );
  });

  it("leaves the separators alone, so the key stays a path and not one blob", () => {
    expect(new URL(objectUrl(STORE, { bucket: "b", key: "a/b/c.gz" })).pathname).toBe("/b/a/b/c.gz");
  });

  it("goes to a path-style URL, bucket first", () => {
    expect(objectUrl(STORE, { bucket: "njt-archive", key: "events/x.gz" })).toBe(
      "https://abc123.r2.cloudflarestorage.com/njt-archive/events/x.gz",
    );
  });

  it("speaks plain http when the endpoint did, for MinIO locally", () => {
    expect(objectUrl({ ...STORE, useSsl: false }, { bucket: "b", key: "k" })).toBe(
      "http://abc123.r2.cloudflarestorage.com/b/k",
    );
  });

  it("does not try to set `host`, which a fetch refuses to let it own", async () => {
    let seen: Headers | undefined;
    await putVerified(STORE, put("k", Buffer.from("a")), async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response(null, { status: 200, headers: { etag: `"${createHash("md5").update("a").digest("hex")}"` } });
    });
    expect(seen?.has("host")).toBe(false);
    expect(seen?.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=/u);
  });

  it("refuses to believe a store that reports a digest it did not send", async () => {
    await expect(
      putVerified(STORE, put("k", Buffer.from("a")), async () =>
        new Response(null, { status: 200, headers: { etag: '"0000000000000000cafe000000000000"' } }),
      ),
    ).rejects.toThrow(/different digest/u);
  });

  it("reports what the store said when it refuses the upload", async () => {
    await expect(
      putVerified(STORE, put("k", Buffer.from("a")), async () =>
        new Response("SignatureDoesNotMatch", { status: 403 }),
      ),
    ).rejects.toThrow(/403 SignatureDoesNotMatch/u);
  });
});
