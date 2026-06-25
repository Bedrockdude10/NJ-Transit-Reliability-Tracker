import { Link } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { theme } from "../lib/theme";
import { PageTitle, Screen } from "../components/ui";

export default function NotFound() {
  return (
    <Screen>
      <PageTitle title="Not found" subtitle="That screen doesn’t exist." />
      <Link href="/" style={styles.link}>
        Go to System Overview
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { color: theme.colors.accent, fontSize: theme.fontSize.md, fontWeight: "600" },
});
