/** Small API-wide helpers. */

/** An error carrying an HTTP status, thrown by handlers and mapped to JSON. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string): never {
  throw new ApiError(400, message);
}

export function notFound(message: string): never {
  throw new ApiError(404, message);
}

/** URL-safe slug from a human line name, used when the catalog has no match. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Round to one decimal place — percentages and average-delay values. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
