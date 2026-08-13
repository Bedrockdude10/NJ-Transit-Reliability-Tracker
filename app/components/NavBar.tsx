import { Link, usePathname } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { theme } from "../lib/theme";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/map", label: "Map" },
  { href: "/lines", label: "Lines" },
  { href: "/compare", label: "Compare" },
  { href: "/lightrail", label: "Light Rail" },
  { href: "/stations", label: "Stations" },
  { href: "/commute", label: "My Commute" },
  { href: "/connections", label: "Connections" },
  { href: "/alerts", label: "Alerts" },
  { href: "/health", label: "Health" },
  { href: "/about", label: "About" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Brand mark: ascending bars in an accent badge (a reliability/data motif).
 * Fixed brand colors (not theme vars) — react-native-svg can't resolve CSS
 * variables in attributes, and a logo should read consistently in both schemes.
 */
function BrandMark() {
  return (
    <Svg width={28} height={28} viewBox="0 0 28 28">
      <Rect x={0} y={0} width={28} height={28} rx={8} fill="#3dc1ff" />
      <Rect x={6} y={15} width={4} height={7} rx={1.5} fill="#0a1020" />
      <Rect x={12} y={11} width={4} height={11} rx={1.5} fill="#0a1020" />
      <Rect x={18} y={7} width={4} height={15} rx={1.5} fill="#0a1020" />
    </Svg>
  );
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <View style={styles.bar}>
      <Link href="/" style={styles.brandLink}>
        <View style={styles.brand}>
          <BrandMark />
          <Text style={styles.brandText}>
            NJT <Text style={styles.brandAccent}>Reliability</Text>
          </Text>
        </View>
      </Link>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.links}>
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link key={link.href} href={link.href} style={[styles.link, active && styles.linkActive]}>
              <Text style={[styles.linkText, active && styles.linkTextActive]}>{link.label}</Text>
            </Link>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(4),
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  brandLink: { textDecorationLine: "none" },
  brand: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  brandText: { color: theme.colors.text, fontWeight: "800", fontSize: theme.fontSize.md, letterSpacing: -0.3 },
  brandAccent: { color: theme.colors.accent },
  links: { gap: theme.spacing(1), alignItems: "center", paddingRight: theme.spacing(4) },
  link: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: theme.radii.pill },
  linkActive: { backgroundColor: theme.colors.accentSoft },
  linkText: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, fontWeight: "600" },
  linkTextActive: { color: theme.colors.accent, fontWeight: "700" },
});
