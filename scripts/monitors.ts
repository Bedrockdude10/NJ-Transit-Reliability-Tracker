/**
 * Reconciling the checked-in monitor definitions against what the provider has.
 *
 * The decision is separated from the HTTP so it can be tested: which monitors
 * need creating, which need updating, and — the one worth being careful about —
 * which existing monitors are left alone. The sync deliberately does not delete
 * monitors it does not recognise; someone else's check disappearing because this
 * file did not mention it is a worse failure than a stale monitor.
 */

export interface MonitorDefinition {
  name: string;
  path: string;
  checkFrequencySeconds: number;
  requestTimeoutSeconds: number;
  confirmationPeriodSeconds: number;
  recoveryPeriodSeconds: number;
}

/** A monitor as the provider reports it. */
export interface RemoteMonitor {
  id: string;
  url: string;
}

export interface MonitorPlan {
  create: { definition: MonitorDefinition; url: string }[];
  update: { id: string; definition: MonitorDefinition; url: string }[];
  /** Monitors the provider has that this file does not describe. Never touched. */
  unmanaged: RemoteMonitor[];
}

/** The URL a definition monitors, built from one base so staging needs no edit. */
export function monitorUrl(baseUrl: string, definition: MonitorDefinition): string {
  return `${baseUrl.replace(/\/+$/, "")}${definition.path}`;
}

export function planMonitors(
  baseUrl: string,
  definitions: readonly MonitorDefinition[],
  remote: readonly RemoteMonitor[],
): MonitorPlan {
  const wanted = definitions.map((definition) => ({
    definition,
    url: monitorUrl(baseUrl, definition),
  }));
  const byUrl = new Map(remote.map((monitor) => [monitor.url, monitor]));

  const plan: MonitorPlan = { create: [], update: [], unmanaged: [] };
  for (const entry of wanted) {
    const existing = byUrl.get(entry.url);
    if (existing) plan.update.push({ id: existing.id, ...entry });
    else plan.create.push(entry);
  }

  const managed = new Set(wanted.map((entry) => entry.url));
  plan.unmanaged = remote.filter((monitor) => !managed.has(monitor.url));
  return plan;
}

/**
 * A definition in Better Stack's vocabulary.
 *
 * Kept in one function so the mapping between what this repo cares about and
 * what the vendor calls it exists once. `monitor_type: "expected_status_code"`
 * with an explicit 200 rather than the default "status": the default treats any
 * 2xx/3xx as up, and `/health/live` says what it means with a 503 that a
 * looser check would have to be told about separately.
 */
export function toBetterStackPayload(definition: MonitorDefinition, url: string) {
  return {
    url,
    pronounceable_name: definition.name,
    monitor_type: "expected_status_code",
    expected_status_codes: [200],
    check_frequency: definition.checkFrequencySeconds,
    request_timeout: definition.requestTimeoutSeconds,
    confirmation_period: definition.confirmationPeriodSeconds,
    recovery_period: definition.recoveryPeriodSeconds,
    email: true,
  };
}
