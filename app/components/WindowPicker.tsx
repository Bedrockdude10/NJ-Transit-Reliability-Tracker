import { SegmentedControl } from "./ui";
import { WINDOWS, type WindowKey } from "../lib/windows";

const OPTIONS = WINDOWS.map((w) => ({ key: w.key, label: w.label }));

/** Trailing-window selector. `days` is derived by `useWindow`, never passed. */
export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (key: WindowKey) => void }) {
  return <SegmentedControl options={OPTIONS} value={value} onChange={(key) => onChange(key as WindowKey)} />;
}
