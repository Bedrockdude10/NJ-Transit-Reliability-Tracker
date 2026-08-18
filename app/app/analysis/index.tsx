import { TabbedPage } from "../../components/TabbedPage";
import { ComparePanel } from "../../screens/ComparePanel";
import { LightRailPanel } from "../../screens/LightRailPanel";
import { PredictionsPanel } from "../../screens/PredictionsPanel";

/** Cuts across the system rather than describing one trip: comparisons, other modes, forecasts. */
export default function Analysis() {
  return (
    <TabbedPage
      tabs={[
        { key: "compare", label: "Compare lines", render: () => <ComparePanel /> },
        { key: "lightrail", label: "Light Rail", render: () => <LightRailPanel /> },
        { key: "predictions", label: "Predictions", render: () => <PredictionsPanel /> },
      ]}
    />
  );
}
