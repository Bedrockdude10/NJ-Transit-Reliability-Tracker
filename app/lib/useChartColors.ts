import { useColorScheme } from "react-native";
import { DARK, LIGHT, type Palette } from "./palette";

/**
 * Concrete colors for the active scheme. SVG (react-native-svg) renders colors
 * as presentation attributes, which do NOT resolve CSS `var()` — so SVG
 * components (and any caller passing colors into them) must use these concrete
 * values instead of `theme.colors` (which are `var(--njt-...)`). Re-renders when
 * the OS color scheme changes.
 */
export function useChartColors(): Palette {
  return useColorScheme() === "light" ? LIGHT : DARK;
}
