import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, PageTitle, Screen, SectionTitle } from "../../components/ui";
import { theme } from "../../lib/theme";

/** A line of body copy with an optional inline bold lead-in. */
function P({ lead, children }: { lead?: string; children: ReactNode }) {
  return (
    <Text style={styles.body}>
      {lead ? <Text style={styles.lead}>{lead} </Text> : null}
      {children}
    </Text>
  );
}

/**
 * Methodology / About — a static explainer of what each metric means, where the
 * data comes from, and what's real vs. modeled. No API calls; pure content so
 * the page renders even when the backend is down.
 */
export default function About() {
  return (
    <Screen>
      <PageTitle
        title="Methodology & data"
        subtitle="What the numbers mean, where they come from, and what they don't claim"
      />

      <Card>
        <SectionTitle>What this is</SectionTitle>
        <P>
          An independent reliability tracker for NJ Transit commuter rail. It puts NJ Transit's own published
          performance next to stricter, independently-computed measures so you can see how reliability looks under
          a tighter definition of “on time.”
        </P>
        <P lead="Not affiliated with NJ Transit.">
          Figures are derived from NJT's public feeds and published reports. Nothing here is an official NJT number
          except where explicitly labeled “NJT.”
        </P>
      </Card>

      <Card>
        <SectionTitle>On-time performance (OTP)</SectionTitle>
        <P lead="NJT's definition:">
          a train is “on time” if it arrives at its final terminal within 6 minutes of schedule. That's a generous
          bar — a train can be 5 minutes late at every stop and still count as on time.
        </P>
        <P lead="Our independent OTP:">
          we recompute the same trains at stricter thresholds — within 5, 10, and 15 minutes — so a 6-minute figure
          of 95% and a 15-minute figure tell you very different things about your actual commute.
        </P>
        <P>
          We also report average, median, and 90th-percentile delay, plus a full delay distribution, because a
          single percentage hides how bad the bad days get.
        </P>
      </Card>

      <Card>
        <SectionTitle>Data sources</SectionTitle>
        <P lead="GTFS static (real, keyless):">
          NJT's published schedule — stations, coordinates, lines, official colors, and trips. This is the network
          the map and every line is drawn from.
        </P>
        <P lead="Monthly performance reports (real, keyless):">
          NJT's published per-line OTP, Amtrak-adjusted OTP, cancellations with cause breakdowns, and fleet
          mean-distance-between-failures (MDBF), back to 2017.
        </P>
        <P lead="GTFS-Realtime + alerts (real, needs a key):">
          live trip updates and service alerts. When a feed key is configured, the tracker collects per-train
          arrivals continuously and the independent OTP, heatmaps, and connection reliability become measured rather
          than modeled.
        </P>
      </Card>

      <View style={styles.callout}>
        <Text style={styles.calloutTitle}>Real vs. modeled — read this</Text>
        <P>
          <Text style={styles.realTag}>REAL</Text> NJT official OTP, cancellations & causes, MDBF, light-rail OTP,
          and the entire GTFS network (stations, lines, colors, coordinates).
        </P>
        <P>
          <Text style={styles.synthTag}>MODELED</Text> the independent per-train OTP, delay distributions,
          time-of-day heatmaps, connection reliability, and worst-trip rankings are generated from a synthetic
          schedule-realistic model until a GTFS-Realtime key is collecting live data. They demonstrate the
          methodology; they are not yet measurements of real trains.
        </P>
      </View>

      <Card>
        <SectionTitle>Other metrics</SectionTitle>
        <P lead="Amtrak attribution:">
          on the Northeast Corridor and North Jersey Coast Line, NJT runs on Amtrak-owned track and attributes some
          delay to Amtrak. We show both the headline OTP and NJT's Amtrak-adjusted figure so the gap is visible. The
          attribution is NJT's own.
        </P>
        <P lead="Cancellations:">
          NJT reports cancellations with a cause category (weather, mechanical, Amtrak, etc.). We surface the full
          breakdown rather than a single rate.
        </P>
        <P lead="MDBF (fleet reliability):">
          mean distance between failures — average miles a railcar travels before a service-affecting failure.
          Higher is better.
        </P>
        <P lead="Connection reliability:">
          for a transfer, the share of days the outbound train was still catchable given the inbound train's actual
          arrival. Below {30} observations we mark it preliminary.
        </P>
      </Card>

      <Card>
        <SectionTitle>Caveats</SectionTitle>
        <P>
          • NJT's published months can lag, and occasional months are missing — the Health page tracks coverage gaps.
        </P>
        <P>
          • The “system” official figure is the trips-weighted aggregate of the per-line reports, not a separately
          published number.
        </P>
        <P>
          • Independent figures only exist for dates the live feed was collecting; before that there is no
          independent history, only NJT's monthly reports.
        </P>
        <P>
          • This is a public, best-effort tool. It is not guaranteed accurate, complete, or real-time, and should not
          be used for operational decisions.
        </P>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: 22 },
  lead: { fontWeight: "700" },
  callout: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  calloutTitle: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "800" },
  realTag: { color: theme.colors.good, fontWeight: "800" },
  synthTag: { color: theme.colors.warn, fontWeight: "800" },
});
