/** Tiny helpers for JSON TEXT columns, typed for the maps we store. */

export type CountMap = Record<string, number>;

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseCountMap(text: string): CountMap {
  return JSON.parse(text) as CountMap;
}

export function parseStringArray(text: string): string[] {
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

/** SQLite stores booleans as 0/1 INTEGER. */
export function toSqlBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromSqlBool(value: number): boolean {
  return value !== 0;
}
