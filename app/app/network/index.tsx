import { TabbedPage } from "../../components/TabbedPage";
import { LinesPanel } from "../../screens/LinesPanel";
import { MapPanel } from "../../screens/MapPanel";
import { StationsPanel } from "../../screens/StationsPanel";

/** The network itself: where it runs, which lines, which stations. */
export default function Network() {
  return (
    <TabbedPage
      tabs={[
        { key: "map", label: "Map", render: () => <MapPanel /> },
        { key: "lines", label: "Lines", render: () => <LinesPanel /> },
        { key: "stations", label: "Stations", render: () => <StationsPanel /> },
      ]}
    />
  );
}
