import { DISCLAIMER_TEXT } from "@njt/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import React from "react";
import { DisclaimerFooter } from "../DisclaimerFooter";
import { createQueryClient } from "../../lib/query-client";

/**
 * This footer lives in the root layout, which makes it the one component whose
 * data fetching can take the whole app down — and it did.
 *
 * When the hooks moved to Suspense, the footer's `/health` query started
 * suspending the entire app shell (every screen blank, stuck on the router's
 * loading splash) and, on failure, threw past every screen-level boundary to
 * the root with nothing to catch it. Verified in the browser with the API
 * stopped: no nav, no title, no disclaimer, just an empty page.
 *
 * So the two things below are not cosmetic. The disclaimer is a compliance
 * requirement that has to render regardless, and anything in the root layout
 * that fetches needs its own boundary.
 */

const renderFooter = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DisclaimerFooter />
    </QueryClientProvider>,
  );

describe("DisclaimerFooter", () => {
  const okResponse = {
    collectionStartDate: "2026-07-09",
    uptimePercent: 100,
    feeds: [{ feedType: "TripUpdates", lastSuccessAtMs: 1_786_622_400_000, lastFailureAtMs: null, pollsToday: 1, failuresToday: 0 }],
    knownGaps: [],
    officialCoverage: [],
    generatedAtMs: 1_786_622_400_000,
  };

  afterEach(() => jest.restoreAllMocks());

  it("shows the disclaimer immediately, without waiting on /health", () => {
    jest.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}) as Promise<Response>);
    // A never-resolving health request must not hold up the layout.
    const { getByText } = renderFooter();
    expect(getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it("keeps the disclaimer, and degrades quietly, when /health fails", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const { getByText, queryByText } = renderFooter();

    // retry: 1 with backoff, so this needs more than waitFor's default second.
    await waitFor(() => expect(getByText("Collection status unavailable")).toBeTruthy(), { timeout: 8000 });
    expect(getByText(DISCLAIMER_TEXT)).toBeTruthy();
    // Not the full-width error card — a footer is the wrong place for one.
    expect(queryByText("Couldn’t load data")).toBeNull();
  });

  it("reports live collection once /health answers", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => okResponse,
    } as Response);

    const { getByText } = renderFooter();
    await waitFor(() => expect(getByText("Live collection")).toBeTruthy());
    expect(getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });
});
