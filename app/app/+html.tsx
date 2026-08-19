import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { DARK, LIGHT } from "../lib/palette";
import { buildThemeCss, FONT_HREF, STYLE_ELEMENT_ID } from "../lib/themeCss";

/**
 * Web-only HTML shell for every statically-rendered page: document `<head>`,
 * the color tokens and base CSS. `:root` is dark; `prefers-color-scheme: light`
 * swaps the light scheme, so the app re-themes with no JS.
 */

// Open Graph needs absolute URLs. Defaults to the live Worker URL; override with
// EXPO_PUBLIC_SITE_URL for a custom domain.
const DEFAULT_SITE_URL = "https://nj-transit-reliability-tracker.dannyrollo4.workers.dev";
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/u, "");
const TITLE = "NJ Transit Reliability Tracker";
const DESCRIPTION =
  "Independent on-time performance for NJ Transit rail — stricter delay thresholds, line comparisons, and cancellation causes alongside NJT's official figures.";
const OG_IMAGE = SITE_URL ? `${SITE_URL}/og-image.png` : "/og-image.png";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Inter (UI) + JetBrains Mono (codes/IDs), with a system fallback. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: buildThemeCss() is theme constants, no untrusted input */}
        <style id={STYLE_ELEMENT_ID} dangerouslySetInnerHTML={{ __html: buildThemeCss() }} />

        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={DARK.background} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={LIGHT.background} />
        {SITE_URL ? <link rel="canonical" href={SITE_URL} /> : null}

        {/* Open Graph (Facebook, LinkedIn, iMessage, Slack, …) */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={TITLE} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        {SITE_URL ? <meta property="og:url" content={SITE_URL} /> : null}

        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
