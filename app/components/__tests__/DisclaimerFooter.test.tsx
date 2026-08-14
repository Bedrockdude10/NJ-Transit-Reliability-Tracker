import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import React from "react";
import { DISCLAIMER_TEXT } from "@njt/shared";
import { DisclaimerFooter } from "../DisclaimerFooter";
import { createQueryClient } from "../../lib/query-client";

/**
 * The footer sits in the root layout, so it is the one component whose failure
 * can take the whole app with it — and it did. Converting the hooks to suspense
 * without giving it a boundary meant a pending /health suspended the entire app
 * shell (every screen blank, stuck on the loading splash) and a failing one
 * escaped to the root with nothing to catch it.
 *
 * The disclaimer is also a compliance requirement, so it has to render whatever
 * the API is doing.
 */

const renderFooter = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DisclaimerFooter />
    </QueryClientProvider>,
  );

describe("DisclaimerFooter", () => {
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
  });

  it("shows the disclaimer immediately, without waiting on /health", () => {
    globalThis.fetch = jest.fn(() => new Promise(() => {})) as never; // never resolves
    const { getByText } = renderFooter();
    // Rendered synchronously: the footer must not suspend its own parent.
    expect(getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it("keeps the disclaimer when /health fails, and says so quietly", async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as never;
    const { getByText, queryByText } = renderFooter();

    await waitFor(() => expect(getByText("Collection status unavailable")).toBeTruthy());
    expect(getByText(DISCLAIMER_TEXT)).toBeTruthy();
    // A full-width error card in the footer would be wrong.
    expect(queryByText("Couldn’t load data")).toBeNull();
  });

  it("reports live collection once /health answers", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          collectionStartDate: "2026-07-09",
          uptimePercent: 100,
          feeds: [{ feedType: "TripUpdates", lastSuccessAtMs: 1_786_622_400_000, lastFailureAtMs: null, pollsToday: 1, failuresToday: 0 }],
          knownGaps: [],
          officialCoverage: [],
          generatedAtMs: 1_786_622_400_000,
        }),
      }),
    ) as never;

    const { getByText } = renderFooter();
    await waitFor(() => expect(getByText("Live collection")).toBeTruthy());
  });
});
