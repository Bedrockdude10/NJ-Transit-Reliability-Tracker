/**
 * The document-level CSS that powers theming: color tokens as CSS variables
 * (dark in `:root`, light via `prefers-color-scheme`) plus base typography and
 * chrome. Built from `palette.ts` so it's the single source of truth.
 *
 * This is injected two ways so it works everywhere:
 *  - `app/app/+html.tsx` emits it in the static export (production, no flash).
 *  - `ensureWebTheme()` injects it at runtime for the Expo dev server, which
 *    does NOT apply `+html.tsx`. The `id` guard prevents double-injection.
 */
import { DARK, LIGHT, type Palette } from "./palette";

const STYLE_ID = "njt-theme";
const FONT_ID = "njt-fonts";
export const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap";

const toVars = (p: Palette) => (Object.keys(p) as (keyof Palette)[]).map((k) => `--njt-${k}: ${p[k]};`).join(" ");

export function buildThemeCss(): string {
  return `
    :root { color-scheme: light dark; ${toVars(DARK)} }
    @media (prefers-color-scheme: light) { :root { ${toVars(LIGHT)} } }
    html, body, #root {
      margin: 0;
      background-color: var(--njt-background);
      color: var(--njt-text);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-variant-numeric: tabular-nums;
      text-rendering: optimizeLegibility;
    }
    html { scroll-behavior: smooth; }
    ::selection { background: rgba(56,160,230,0.30); }
    * { scrollbar-width: thin; scrollbar-color: var(--njt-borderStrong) transparent; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: var(--njt-border); border-radius: 999px; border: 2px solid var(--njt-background); }
    ::-webkit-scrollbar-thumb:hover { background: var(--njt-borderStrong); }
    :focus-visible { outline: 2px solid var(--njt-accent); outline-offset: 2px; border-radius: 4px; }
  `;
}

export const STYLE_ELEMENT_ID = STYLE_ID;

/** Inject the theme CSS + web fonts at runtime (dev server). No-op off web or if already present. */
export function ensureWebTheme(): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildThemeCss();
    document.head.appendChild(style);
  }
  if (!document.getElementById(FONT_ID)) {
    const link = document.createElement("link");
    link.id = FONT_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }
}
