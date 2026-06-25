import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.pageTitle}>
      <Text style={styles.pageTitleText}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function StatTile({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, color ? { color } : null]}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

export function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <View style={[styles.row, wrap ? styles.wrap : null]}>{children}</View>;
}

export function Badge({ text, color = theme.colors.surfaceAlt }: { text: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorText}>Couldn’t load data</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retry} onPress={onRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  screenContent: { padding: theme.spacing(4), gap: theme.spacing(4), maxWidth: 1000, width: "100%", alignSelf: "center" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius, padding: theme.spacing(4), gap: theme.spacing(3), borderWidth: 1, borderColor: theme.colors.border },
  sectionTitle: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "700" },
  pageTitle: { gap: theme.spacing(1) },
  pageTitleText: { color: theme.colors.text, fontSize: theme.fontSize.xxl, fontWeight: "800" },
  subtitle: { color: theme.colors.textMuted, fontSize: theme.fontSize.md },
  tile: { flexGrow: 1, flexBasis: 130, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius, padding: theme.spacing(3), gap: theme.spacing(1) },
  tileLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  tileValue: { color: theme.colors.text, fontSize: theme.fontSize.xl, fontWeight: "700" },
  tileHint: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  row: { flexDirection: "row", gap: theme.spacing(3) },
  wrap: { flexWrap: "wrap" },
  badge: { paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1), borderRadius: 999 },
  badgeText: { color: theme.colors.text, fontSize: theme.fontSize.xs, fontWeight: "600" },
  center: { padding: theme.spacing(8), alignItems: "center", gap: theme.spacing(2) },
  muted: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, textAlign: "center" },
  errorText: { color: theme.colors.bad, fontSize: theme.fontSize.lg, fontWeight: "700" },
  retry: { marginTop: theme.spacing(2), backgroundColor: theme.colors.accent, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2), borderRadius: theme.radius },
  retryText: { color: theme.colors.background, fontWeight: "700" },
});
