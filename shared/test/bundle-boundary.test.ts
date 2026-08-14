import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `app` imports `@njt/shared`, and Metro bundles whole modules rather than
 * tree-shaking function-by-function. So anything reachable from the package
 * index ships to every rider's phone and browser.
 *
 * The Temporal polyfill measured at +160 KB — 12% of the exported web bundle —
 * to serve `localPartsToEpochSeconds`, which the app never calls. It lives in
 * `time-zoned.ts`, reached only through the `@njt/shared/zoned` subpath that
 * `pipeline` and `api` import.
 *
 * That boundary is invisible: adding `export * from "./time-zoned"` to the
 * index would restore the 160 KB with no test failing and no reviewer noticing.
 * Hence this test, which walks the real import graph rather than trusting it.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Modules that must never reach the app, and why. */
const SERVER_ONLY_DEPENDENCIES = ["@js-temporal/polyfill"];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  // Covers `import ... from "x"`, bare `import "x"`, and `export ... from "x"`.
  return [...source.matchAll(/(?:import|export)[\s\S]*?from\s*"([^"]+)"|import\s*"([^"]+)"/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
}

/** Every module reachable from an entry point, plus every package it pulls in. */
function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".")) {
        packages.add(spec);
        continue;
      }
      const target = resolve(dirname(file), `${spec}.ts`);
      queue.push(target);
    }
  }
  return { files, packages };
}

describe("app bundle boundary", () => {
  it("keeps server-only dependencies out of the package index", () => {
    const { packages } = reachable(resolve(SRC, "index.ts"));
    for (const dependency of SERVER_ONLY_DEPENDENCIES) {
      expect(
        [...packages],
        `${dependency} became reachable from @njt/shared, so it now ships in the app bundle`,
      ).not.toContain(dependency);
    }
  });

  it("still reaches Temporal through the zoned subpath", () => {
    // Guards the guard: if the polyfill were dropped entirely the test above
    // would pass for the wrong reason.
    const { packages } = reachable(resolve(SRC, "time-zoned.ts"));
    expect([...packages]).toContain("@js-temporal/polyfill");
  });

  it("exposes the zoned entry point as a package subpath", () => {
    const manifest = JSON.parse(readFileSync(resolve(SRC, "../package.json"), "utf8"));
    expect(manifest.exports["./zoned"]).toBeDefined();
    expect(manifest.dependencies["@js-temporal/polyfill"]).toBeDefined();
  });
});
