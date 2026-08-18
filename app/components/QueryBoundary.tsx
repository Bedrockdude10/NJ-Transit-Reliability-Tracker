import { QueryErrorResetBoundary } from "@tanstack/react-query";
import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorView, SkeletonCard } from "./ui";

/**
 * The one place a screen's data can be pending or broken.
 *
 * Whether an error arrives here at all is decided by `throwOnError` in
 * `query-client.ts`: a failure with data already on screen is reported inline
 * instead. `QueryErrorResetBoundary` is required for Retry to do anything —
 * without the reset the still-errored query re-renders straight back to an error.
 */
export function QueryBoundary({
  children,
  pending,
  failed,
}: {
  children: React.ReactNode;
  /** Shown while the data is first loading. Defaults to a skeleton card. */
  pending?: React.ReactNode;
  /** Replaces the default error card, where a full-width panel would be wrong. */
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
