import type { ReactNode } from "react";
import { useTab } from "../hooks/useTab";
import { Screen, SegmentedControl } from "./ui";

export interface PageTab<T extends string> {
  key: T;
  label: string;
  render: () => ReactNode;
}

/**
 * A top-level page made of tabbed panels. Only the selected panel is rendered,
 * so an unopened tab costs no queries.
 */
export function TabbedPage<T extends string>({ tabs }: { tabs: readonly PageTab<T>[] }) {
  const { tab, select } = useTab(tabs.map((t) => t.key));
  const active = tabs.find((t) => t.key === tab);
  if (active === undefined) throw new Error("TabbedPage requires at least one tab");

  return (
    <Screen>
      <SegmentedControl options={tabs.map(({ key, label }) => ({ key, label }))} value={active.key} onChange={select} />
      {active.render()}
    </Screen>
  );
}
