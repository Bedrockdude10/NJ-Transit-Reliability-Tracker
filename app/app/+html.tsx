import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * Web-only HTML shell wrapping every statically-rendered page. This is where
 * document-level <head> content lives: the title, description, and Open
 * Graph / Twitter card tags that control how the site previews when shared.
 *
 * Absolute URLs are required for social images, so they're built from
 * EXPO_PUBLIC_SITE_URL (set at build time to the deployed web origin). The card
 * image is expected at `public/og-image.png` (1200×630) — see DEPLOY.md.
 */

const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
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

        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content="#0f172a" />
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
