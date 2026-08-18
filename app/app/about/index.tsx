import { TabbedPage } from "../../components/TabbedPage";
import { AboutPanel } from "../../screens/AboutPanel";
import { HealthPanel } from "../../screens/HealthPanel";

/**
 * How to read the numbers, and whether they were collected properly.
 * Methodology and pipeline health are the same question — "can I trust this?" —
 * asked about the definitions and about the data.
 */
export default function About() {
  return (
    <TabbedPage
      tabs={[
        { key: "methodology", label: "Methodology", render: () => <AboutPanel /> },
        { key: "health", label: "Data health", render: () => <HealthPanel /> },
      ]}
    />
  );
}
