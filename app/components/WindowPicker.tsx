import { SegmentedControl } from "./ui";
import { WINDOWS, type WindowKey } from "../lib/windows";

const OPTIONS = WINDOWS.map((w) => ({ key: w.key, label: w.label }));
const DAYS = new Map<WindowKey, number>(WINDOWS.map((w) => [w.key, w.days]));

/** Trailing-window selector, styled as a segmented control. */
export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (key: WindowKey, days: number) => void }) {
  return <SegmentedControl options={OPTIONS} value={value} onChange={(key) => onChange(key, DAYS.get(key) ?? 30)} />;
}
