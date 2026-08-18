/**
 * Document-level theming CSS, built from `palette.ts`. Injected twice, because
 * the Expo dev server does not apply `+html.tsx`: the static export emits it,
 * and `ensureWebTheme()` adds it at runtime under an `id` guard.
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

/** For the dev server. No-op off web, or if already present. */
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
