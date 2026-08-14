import { SegmentedControl } from "./ui";
import { WINDOWS, type WindowKey } from "../lib/windows";

const OPTIONS = WINDOWS.map((w) => ({ key: w.key, label: w.label }));

/**
 * Trailing-window selector, styled as a segmented control.
 *
 * `onChange` used to hand back `(key, days)` so each caller could store both.
 * `days` is a function of `key` (`windowDays`), so passing it invited every
 * screen to keep a second copy of the same fact; `useWindow` derives it now.
 */
export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (key: WindowKey) => void }) {
  return <SegmentedControl options={OPTIONS} value={value} onChange={(key) => onChange(key as WindowKey)} />;
}
