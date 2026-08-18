import type { ReactNode } from "react";
import { useTab } from "../hooks/useTab";
import { Screen, SegmentedControl } from "./ui";

export interface PageTab<T extends string> {
  key: T;
  label: string;
  render: () => ReactNode;
}

/**
 * A top-level page made of tabbed panels.
 *
 * The nav used to carry one button per panel — twelve of them, scrolling
 * sideways — which made every panel look like a separate destination and left
 * no cue about which ones answer related questions. Grouping them into five
 * pages puts the choice between sibling views *inside* the page, where it is a
 * cheap switch rather than a navigation.
 *
 * Only the selected panel is rendered, so an unopened tab costs no queries.
 */
export function TabbedPage<T extends string>({ tabs }: { tabs: readonly PageTab<T>[] }) {
  const { tab, select } = useTab(tabs.map((t) => t.key));
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <Screen>
      <SegmentedControl options={tabs.map(({ key, label }) => ({ key, label }))} value={active.key} onChange={select} />
      {active.render()}
    </Screen>
  );
}
