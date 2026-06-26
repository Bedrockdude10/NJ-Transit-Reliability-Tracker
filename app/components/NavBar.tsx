import { Link, usePathname } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/map", label: "Map" },
  { href: "/lines", label: "Lines" },
  { href: "/compare", label: "Compare" },
  { href: "/lightrail", label: "Light Rail" },
  { href: "/stations", label: "Stations" },
  { href: "/connections", label: "Connections" },
  { href: "/alerts", label: "Alerts" },
  { href: "/health", label: "Health" },
  { href: "/about", label: "About" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <View style={styles.bar}>
      <Text style={styles.brand}>NJT Reliability</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.links}>
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link key={link.href} href={link.href} style={[styles.link, active && styles.linkActive]}>
              {link.label}
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
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  brand: { color: theme.colors.njt, fontWeight: "800", fontSize: theme.fontSize.md },
  links: { gap: theme.spacing(4), alignItems: "center", paddingRight: theme.spacing(4) },
  link: { color: theme.colors.textMuted, fontSize: theme.fontSize.md, fontWeight: "600" },
  linkActive: { color: theme.colors.accent },
});
