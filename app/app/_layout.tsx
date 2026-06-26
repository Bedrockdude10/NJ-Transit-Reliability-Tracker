import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { DisclaimerFooter } from "../components/DisclaimerFooter";
import { NavBar } from "../components/NavBar";
import { theme } from "../lib/theme";
import { ensureWebTheme } from "../lib/themeCss";

// Inject theme CSS variables + fonts at import time. The static export uses
// `+html.tsx`, but the dev server does not — this makes both work (and is a
// no-op when `+html.tsx` already injected the same <style id>).
ensureWebTheme();

/** Root layout: persistent nav + footer wrapping every deep-linkable screen. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.colors.surface }}>
          <NavBar />
        </SafeAreaView>
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.colors.surface }}>
          <DisclaimerFooter />
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}
