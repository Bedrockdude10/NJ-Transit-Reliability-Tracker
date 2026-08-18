import { QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { DisclaimerFooter } from "../components/DisclaimerFooter";
import { NavBar } from "../components/NavBar";
import { createQueryClient } from "../lib/query-client";
import { theme } from "../lib/theme";
import { ensureWebTheme } from "../lib/themeCss";

// The dev server does not apply `+html.tsx`. No-op when it already injected the
// same <style id>.
ensureWebTheme();

// Module scope, so a re-render never discards the cache.
const queryClient = createQueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
