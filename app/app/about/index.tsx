import { TabbedPage } from "../../components/TabbedPage";
import { AboutPanel } from "../../screens/AboutPanel";
import { HealthPanel } from "../../screens/HealthPanel";

/** Methodology and pipeline health: both answer "can I trust this?". */
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
