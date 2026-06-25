import { defineConfig } from "vitest/config";

/**
 * Root Vitest config. Each Node workspace package is a separate project so they
 * can run in isolation or together via `npm test`. The Expo `app` package is
 * intentionally excluded — it uses jest-expo (React Native preset) instead.
 */
const nodePackages = ["shared", "db", "pipeline", "api"] as const;

export default defineConfig({
  test: {
    projects: [
      ...nodePackages.map((name) => ({
        test: {
          name,
          root: `./${name}`,
          environment: "node",
          include: ["test/**/*.test.ts", "src/**/*.test.ts"],
        },
      })),
      // The app's pure logic (no React Native imports) runs under Vitest; its
      // components use jest-expo via `npm test --workspace app`.
      {
        test: {
          name: "app",
          root: "./app",
          environment: "node",
          include: ["lib/**/*.test.ts"],
        },
      },
    ],
  },
});
