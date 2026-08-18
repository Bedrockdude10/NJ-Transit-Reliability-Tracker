import { TabbedPage } from "../../components/TabbedPage";
import { AlertsPanel } from "../../screens/AlertsPanel";
import { CommutePanel } from "../../screens/CommutePanel";
import { ConnectionsPanel } from "../../screens/ConnectionsPanel";

/** One rider's journey: their own trip, the transfer it depends on, and what is disrupted. */
export default function Trips() {
  return (
    <TabbedPage
      tabs={[
        { key: "commute", label: "My Commute", render: () => <CommutePanel /> },
        { key: "connections", label: "Connections", render: () => <ConnectionsPanel /> },
        { key: "alerts", label: "Alerts", render: () => <AlertsPanel /> },
      ]}
    />
  );
}
