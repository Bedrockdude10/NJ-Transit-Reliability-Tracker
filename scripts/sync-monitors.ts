/**
 * Apply `deploy/monitors.json` to Better Stack.
 *
 *   BETTERSTACK_API_TOKEN=… NJT_PUBLIC_API_URL=https://… npm run monitors:sync
 *   … npm run monitors:sync -- --dry-run
 *
 * Provisioning a hosted monitor, not building one. The checking, the alerting
 * and the on-call routing are all the vendor's; what lives here is the answer to
 * "what are we watching, how often, and how long before it pages" — which is a
 * decision worth reviewing in a diff rather than remembering to re-click.
 *
 * Idempotent: monitors are matched by URL, created if absent and updated if not.
 * Monitors this file does not describe are reported and left alone.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type MonitorDefinition,
  type RemoteMonitor,
  monitorUrl,
  planMonitors,
  toBetterStackPayload,
} from "./monitors";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://uptime.betterstack.com/api/v2/monitors";

const token = process.env.BETTERSTACK_API_TOKEN;
const baseUrl = process.env.NJT_PUBLIC_API_URL;
const dryRun = process.argv.includes("--dry-run");

if (!baseUrl) {
  console.error("NJT_PUBLIC_API_URL is required — the base URL of the deployed API.");
  process.exit(1);
}
if (!token && !dryRun) {
  console.error(
    "BETTERSTACK_API_TOKEN is required. Better Stack → Settings → API tokens.\n" +
      "Run with --dry-run to see what would be applied without one.",
  );
  process.exit(1);
}

const { monitors } = JSON.parse(readFileSync(resolve(ROOT, "deploy/monitors.json"), "utf8")) as {
  monitors: MonitorDefinition[];
};

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

/** Every existing monitor, following the pagination rather than taking page one. */
async function listMonitors(): Promise<RemoteMonitor[]> {
  const found: RemoteMonitor[] = [];
  let next: string | null = API;
  while (next) {
    const page = (await call(next)) as {
      data: { id: string; attributes: { url: string } }[];
      pagination?: { next: string | null };
    };
    for (const item of page.data) found.push({ id: item.id, url: item.attributes.url });
    next = page.pagination?.next ?? null;
  }
  return found;
}

const remote = dryRun && !token ? [] : await listMonitors();
const plan = planMonitors(baseUrl, monitors, remote);

for (const entry of plan.create) console.log(`create  ${entry.definition.name.padEnd(14)} ${entry.url}`);
for (const entry of plan.update) console.log(`update  ${entry.definition.name.padEnd(14)} ${entry.url}`);
for (const monitor of plan.unmanaged) console.log(`leave   ${"(unmanaged)".padEnd(14)} ${monitor.url}`);

if (dryRun) {
  console.log("\nDry run — nothing applied.");
  process.exit(0);
}

for (const entry of plan.create) {
  await call(API, { method: "POST", body: JSON.stringify(toBetterStackPayload(entry.definition, entry.url)) });
}
for (const entry of plan.update) {
  await call(`${API}/${entry.id}`, {
    method: "PATCH",
    body: JSON.stringify(toBetterStackPayload(entry.definition, entry.url)),
  });
}

console.log(
  `\nApplied: ${plan.create.length} created, ${plan.update.length} updated, ${plan.unmanaged.length} left alone.`,
);
console.log(`Confirm at https://uptime.betterstack.com/monitors — and test it: ${monitorUrl(baseUrl, monitors[0]!)}`);
