import { useColorScheme } from "react-native";
import { DARK, LIGHT, type Palette } from "./palette";

/**
 * Concrete colors for the active scheme. SVG presentation attributes do not
 * resolve CSS `var()`, so anything feeding SVG must use these, not `theme.colors`.
 */
export function useChartColors(): Palette {
  return useColorScheme() === "light" ? LIGHT : DARK;
}
