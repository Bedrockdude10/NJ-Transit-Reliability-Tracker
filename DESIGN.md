# Design notes

How the NJT Reliability Tracker looks and why. This is the companion to
[CLAUDE.md](CLAUDE.md) (architecture) — it covers the visual/UX layer: the design
system, the decisions behind it, and where to take it next.

## Goal

Make a public data tool that is **immediately legible** and **worth reading**.
Two failure modes to avoid: (1) a pretty dashboard that says nothing, (2) a
correct dashboard nobody wants to look at. Every screen should answer a real
commuter question — *is my line getting worse? how late, really? which transfer
breaks?* — and answer it at a glance.

## Principles

1. **The number is the hero.** Big, tabular figures; everything else supports
   them. Reliability is the product, so OTP %, grades, and deltas get the most
   visual weight.
2. **One accent, semantic everything else.** A single sky accent for
   interaction; green→amber→red reserved strictly for reliability meaning. Color
   is never decorative — if something is red, it's bad.
3. **Honest framing.** The whole thesis is "NJT's 6-minute bar is generous." The
   UI shows NJT's real figure *next to* stricter measures and the gap between
   them, and labels modeled vs real data plainly (footer status, About page).
4. **Tokens, not one-offs.** Color, type, spacing, radius, and elevation live in
   one place so the look is consistent and a single edit re-themes everything.
5. **Readable density.** Comfortable spacing and a capped content width
   (1040px) so lines of data don't sprawl on wide monitors.

## Design system

Everything derives from two files, so screens stay thin and consistent:

- **`app/lib/theme.ts`** — the token source of truth: a layered dark palette
  (`background → surface → surfaceAlt`), one `accent`, the NJT yellow, and a
  green/amber/red reliability ramp each with a translucent `*Soft` tint for
  badges and callouts. Plus `radii`, `shadow`, `fontFamily`, and type scale.
  `otpColor()` / `otpColorSoft()` map a percentage to its semantic color.
- **`app/components/ui.tsx`** — the primitives every screen composes: `Screen`,
  `Card` (with an optional standardized header), `StatTile` (big tabular value +
  accent strip), `PageTitle`, `Badge`, `SegmentedControl`, `StatusDot`,
  `Skeleton`/`SkeletonCard`, `EmptyState`, `ErrorView`.

### Typography

Web loads **Inter** (UI) + **JetBrains Mono** (codes) in `app/app/+html.tsx`,
which also sets document-level base CSS. React Native Web text inherits
`font-family` from the root, so theming the body styles the whole app in one
place. The single highest-leverage readability win is **`font-variant-numeric:
tabular-nums`** globally — every stat, table, and axis label has
monospaced-width digits so columns of numbers line up and don't jitter as values
change.

### Charts

Pure geometry lives in **`app/lib/charts.ts`** (scales, bar/line layout, smooth
Catmull-Rom paths, area fills, axis ticks, gauge arcs, the heat ramp) and is
unit-tested with no RN dependency. The SVG components
(`LineChart`, `BarChart`, `Heatmap`, `Sparkline`, `Gauge`) just render those
results with `react-native-svg`, so they work identically on web and native with
no chart library, no tiles, and no API keys. Charts gained gridlines + y-axis
labels, gradient area fills, smoothed curves, and labeled endpoints.

### Reliability grades

`app/lib/grade.ts` maps an OTP % to an A–F letter (deliberately demanding bands —
a "B" still means ~1 in 10 trains miss even NJT's loose cutoff). Surfaced as a
`GradeBadge` on the Lines leaderboard (a literal report card) and the line-detail
header. Pure + tested.

### Light & dark mode

The app follows the OS `prefers-color-scheme`. The whole palette is emitted as
**CSS variables** (`--njt-<key>`) — dark in `:root`, light via a
`prefers-color-scheme: light` media query — so every `StyleSheet` (which
references `var(--njt-...)`) re-themes automatically with **no per-component
work and no JS re-render**. Concrete values live in `app/lib/palette.ts`.

Two wrinkles drove the design:

1. **SVG can't read CSS variables** in presentation attributes (`fill`,
   `stroke`). So chart/map components (and any caller passing a color into one)
   take concrete colors for the active scheme from **`useChartColors()`**
   (`useColorScheme`) and use `otpColorAt()` instead of the `var()` helpers.
2. **Expo's dev server doesn't apply `+html.tsx`** (only the static export
   does). So the theme CSS is injected two ways from one source
   (`app/lib/themeCss.ts`): `+html.tsx` emits it for production (no flash), and
   `ensureWebTheme()` injects it at runtime for dev. An `id` guard prevents
   double-injection.

Neutrals shift fully between schemes; the reliability ramp and accent are
*darker* in light mode so values stay legible on white surfaces.

## Signature screens

- **Map** — pan + zoom (mouse wheel / drag, plus +/−/reset controls) via an SVG
  group transform; taps hit-test in base coordinates and open an in-place
  tooltip (deep-link is a secondary action). The close button renders last so it
  paints above the content and stays clickable.

- **Overview** — a hero pairing a radial **Gauge** of NJT's real official OTP
  with the stricter measured reality (≤5 min, ≤15 min) and the point-gap between
  them: the project's thesis in one glance.
- **Lines** — a leaderboard where each row *is* a reliability bar (soft fill to
  OTP%), capped with a letter grade. Ranked worst-first to surface problems.
- **Line detail** — a report-card header (grade + "X% on-time" + month-over-month
  trend arrow from real data), then the strict-threshold bar chart vs NJT's
  6-minute reference line, attribution, and long-run history.

## Data integrity: real vs. modeled

A public tool must never pass off generated data as fact. Two regimes:

- **Real** — NJT's published monthly figures (OTP at 6 min, **trips operated**,
  **cancellations**, MDBF, light-rail OTP) and the GTFS static network
  (stations, lines, colors, coordinates). Shown without a badge.
- **Modeled** — the independent per-train metrics (OTP at strict thresholds,
  delay distribution, time-of-day heatmaps, worst trips, station delays,
  connection reliability). These *require* GTFS-Realtime (per-train arrivals),
  which isn't connected yet, so they're generated by the seed to demonstrate
  the methodology.

Rules enforced in the UI:

1. **Never show modeled where real exists.** Trips operated / cancellations /
   cancellation rate now come from `NjtOfficialComparison` (summed from official
   metrics), not the synthetic event counts that previously populated those
   tiles.
2. **Label everything modeled.** A `<ModeledBadge>` sits on every synthetic card
   (Overview hero stricter-threshold tiles, OTP-vs-NJT, delay distribution,
   heatmaps, line-detail trend/inbound-outbound/worst-trips) and a
   `<ModeledBanner>` heads the fully-modeled screens (station detail,
   connections). Copy avoids the word "measured" for modeled figures.

When the GTFS-RT key is added, the seed is replaced by real collection and the
badges/banners come off — the real/modeled split is the seam to flip.

## Accessibility & polish

- `color-scheme: dark`, branded `::selection`, and a visible `:focus-visible`
  ring (keyboard users get a clear focus outline).
- Pressables carry `accessibilityRole` / `accessibilityState`.
- Reliability is never encoded by color *alone* — grades (letters), the gauge
  value, and explicit numbers carry the same meaning for color-blind readers.
- SPA deep links work on the static host (Worker `not_found_handling`).

## Decisions & trade-offs

- **No chart/UI library.** SVG + a tiny geometry lib keeps the bundle small,
  the look fully controlled, and web/native identical. Cost: we hand-roll
  features a library would give free (tooltips, legends) — added only as needed.
- **Inter via CDN.** A runtime font fetch (vs self-hosting) for simplicity;
  `display=swap` + a system fallback avoids a blocking flash. Revisit if we want
  zero third-party requests.
- **Grades are presentation, not contract.** They live in `app/lib`, not
  `@njt/shared`, since they're a UI affordance over the real OTP, not a stored
  metric.
- **Month-over-month trend reuses fetched data.** Line detail already pulls the
  monthly series, so the trend is computed client-side — no new endpoint. A
  leaderboard-wide trend would need the `/lines` DTO to carry a prior-month
  figure (a clean future addition).

## Where to take it next

- **Leaderboard sparklines / trend** — add `njtOtpPrevMonth` (or a short series)
  to the `/lines` DTO so every row shows momentum, not just a snapshot.
- **OG share image** — generate a per-line card (grade + OTP) for social
  previews; the meta tags already exist in `+html.tsx`.
- **Once GTFS-RT is live** — the modeled per-train screens (heatmaps,
  connections, worst trips) become measured; promote them visually and flip the
  footer/About from "modeled" to "live."
- **Saved/last-viewed line** and a global search (lines + stations) for faster
  navigation.
