import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { theme } from "../lib/theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

/** Surface container. `title`/`subtitle`/`right` add a header row; `tint` makes it a callout. */
export function Card({
  children,
  style,
  title,
  subtitle,
  right,
  tint,
}: {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  title?: string;
  subtitle?: string | undefined;
  right?: ReactNode;
  tint?: string;
}) {
  return (
    <View style={[styles.card, tint ? { backgroundColor: tint } : null, style as ViewStyle]}>
      {title ? (
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderText}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
          </View>
          {right ?? null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** Heads a sub-section inside a card. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.pageTitle}>
      <Text style={styles.pageTitleText}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/** KPI tile. `color` tints the value; `accent` (default: `color`) tints the left strip. */
export function StatTile({
  label,
  value,
  color,
  hint,
  accent,
}: {
  label: string;
  value: string;
  color?: string | undefined;
  hint?: string | undefined;
  accent?: string | undefined;
}) {
  const strip = accent ?? color ?? theme.colors.border;
  return (
    <View style={styles.tile}>
      <View style={[styles.tileStrip, { backgroundColor: strip }]} />
      <View style={styles.tileBody}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={[styles.tileValue, color ? { color } : null]} numberOfLines={1}>
          {value}
        </Text>
        {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

export function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <View style={[styles.row, wrap ? styles.wrap : null]}>{children}</View>;
}

export function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <View style={[styles.dot, { backgroundColor: color }, pulse ? styles.dotPulse : null]}>
      {pulse ? <View style={[styles.dotHalo, { backgroundColor: color }]} /> : null}
    </View>
  );
}

/** `tint` sets the background; `color` sets the text/dot. */
export function Badge({ text, color = theme.colors.textMuted, tint = theme.colors.surfaceAlt }: { text: string; color?: string; tint?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: tint }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text style={[styles.muted, styles.centerText]}>{label}</Text>
    </View>
  );
}

export function Skeleton({ height = 16, width = "100%", radius = theme.radii.sm }: { height?: number; width?: number | string; radius?: number }) {
  return <View style={[styles.skeleton, { height, width: width as number, borderRadius: radius }]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <Skeleton height={18} width="40%" />
      {Array.from({ length: lines }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are identical placeholders with no identity
        <Skeleton key={i} height={12} width={`${90 - i * 12}%`} />
      ))}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.center, styles.errorCard]}>
      <Text style={styles.errorText}>Couldn’t load data</Text>
      <Text style={[styles.muted, styles.centerText]}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={[styles.muted, styles.centerText]}>{hint}</Text> : null}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

/** Pill-style segmented control. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.segments}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  screenContent: { padding: theme.spacing(5), gap: theme.spacing(4), maxWidth: 1040, width: "100%", alignSelf: "center" },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing(5),
    gap: theme.spacing(3),
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing(3) },
  cardHeaderText: { gap: 2, flexShrink: 1 },
  cardSubtitle: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm },

  sectionTitle: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "700", letterSpacing: -0.2 },
  eyebrow: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },

  pageTitle: { gap: theme.spacing(1), marginBottom: theme.spacing(1) },
  pageTitleText: { color: theme.colors.text, fontSize: theme.fontSize.xxl, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: theme.fontSize.md, lineHeight: 22 },

  tile: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: "row",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tileStrip: { width: 4 },
  tileBody: { flex: 1, padding: theme.spacing(3), gap: theme.spacing(1) },
  tileLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600" },
  tileValue: { color: theme.colors.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  tileHint: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },

  row: { flexDirection: "row", gap: theme.spacing(3) },
  wrap: { flexWrap: "wrap" },

  dot: { width: 9, height: 9, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  dotPulse: {},
  dotHalo: { position: "absolute", width: 9, height: 9, borderRadius: 999, opacity: 0.4, transform: [{ scale: 2 }] },

  badge: { paddingHorizontal: theme.spacing(2), paddingVertical: 3, borderRadius: theme.radii.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: theme.fontSize.xs, fontWeight: "700", letterSpacing: 0.2 },

  center: { padding: theme.spacing(8), alignItems: "center", gap: theme.spacing(2) },
  muted: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, lineHeight: 20 },
  centerText: { textAlign: "center" },

  skeleton: { backgroundColor: theme.colors.surfaceAlt, opacity: 0.6 },

  errorCard: { backgroundColor: theme.colors.badSoft, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.colors.bad },
  errorText: { color: theme.colors.bad, fontSize: theme.fontSize.lg, fontWeight: "700" },
  retry: { marginTop: theme.spacing(2), backgroundColor: theme.colors.accent, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2), borderRadius: theme.radii.md },
  retryText: { color: theme.colors.background, fontWeight: "700" },

  empty: { padding: theme.spacing(6), alignItems: "center", gap: theme.spacing(1), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed" },
  emptyTitle: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "600" },

  segments: { flexDirection: "row", backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill, padding: 3, alignSelf: "flex-start", borderWidth: 1, borderColor: theme.colors.border },
  segment: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: theme.radii.pill },
  segmentActive: { backgroundColor: theme.colors.accent },
  segmentLabel: { color: theme.colors.textMuted, fontWeight: "600", fontSize: theme.fontSize.sm },
  segmentLabelActive: { color: theme.colors.background, fontWeight: "700" },
});
