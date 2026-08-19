/**
 * Reconciling the checked-in monitor definitions against what the provider has.
 * Unrecognised monitors are deliberately never deleted: someone else's check
 * vanishing because this file omitted it is worse than a stale monitor.
 */

const TRAILING_SLASHES_RE = /\/+$/u;

export interface MonitorDefinition {
  name: string;
  path: string;
  checkFrequencySeconds: number;
  requestTimeoutSeconds: number;
  confirmationPeriodSeconds: number;
  recoveryPeriodSeconds: number;
}

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

export function monitorUrl(baseUrl: string, definition: MonitorDefinition): string {
  return `${baseUrl.replace(TRAILING_SLASHES_RE, "")}${definition.path}`;
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
 * A definition in Better Stack's vocabulary. `expected_status_code` with an
 * explicit 200, not the default "status": that treats any 2xx/3xx as up, and
 * `/health/live` reports a stalled pipeline with a 503.
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
