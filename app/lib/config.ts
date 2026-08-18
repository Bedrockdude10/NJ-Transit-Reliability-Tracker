/** Metro inlines `EXPO_PUBLIC_*` into process.env at build time; Node reads it directly. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
