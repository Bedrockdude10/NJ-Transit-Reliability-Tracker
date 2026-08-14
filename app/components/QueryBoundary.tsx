import { QueryErrorResetBoundary } from "@tanstack/react-query";
import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorView, SkeletonCard } from "./ui";

/**
 * The one place a screen's data can be pending or broken.
 *
 * Every screen used to re-decide this for itself — 33 hand-written
 * `loading ? … : error ? … : data ? …` ladders across 13 screens, each picking
 * its own spinner and its own answer to "does an error replace the data or sit
 * beside it?". That inconsistency is most of why the app felt assembled rather
 * than designed. React already has the two primitives for it, so this is a
 * wiring component rather than an invention: `Suspense` owns "nothing to show
 * yet" and an error boundary owns "this failed".
 *
 * Which of the two an error reaches is decided by the `throwOnError` predicate
 * in `query-client.ts`: a failure with data already on screen never gets here,
 * so a departure board keeps its times through a blip and reports the problem
 * inline instead.
 *
 * `QueryErrorResetBoundary` is what makes Retry work. Without it the boundary
 * would re-render the same failed query straight back into an error, because
 * the query itself is still in an error state — resetting it is what gives the
 * retry something new to do.
 */
export function QueryBoundary({
  children,
  pending,
  failed,
}: {
  children: React.ReactNode;
  /** Shown while the data is first loading. Defaults to a skeleton card. */
  pending?: React.ReactNode;
  /**
   * Replaces the default error card. For places where a full-width "Couldn't
   * load data" panel would be wrong — the footer's status line, say, where the
   * failure is incidental and the surrounding text still has to render.
   */
  failed?: (message: string, retry: () => void) => React.ReactNode;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => {
            const message = error instanceof Error ? error.message : String(error);
            return failed ? (
              <>{failed(message, resetErrorBoundary)}</>
            ) : (
              <ErrorView message={message} onRetry={resetErrorBoundary} />
            );
          }}
        >
          <Suspense fallback={pending ?? <SkeletonCard lines={4} />}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
