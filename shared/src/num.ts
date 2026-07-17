/** Generic numeric helpers shared across every package. */

/** Round to one decimal place — the project-wide convention for percentages
 * and average-delay values, so the API and the app never disagree on precision. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
