/**
 * Frontend configuration. The API base URL comes from the public env var
 * `EXPO_PUBLIC_API_URL` (Metro inlines `EXPO_PUBLIC_*` into process.env at build
 * time, and Node/Vitest read it directly). Defaults to the local dev API.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
