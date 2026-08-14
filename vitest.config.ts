import { defineConfig } from "vitest/config";

/**
 * Root Vitest config. Each Node workspace package is a separate project so they
 * can run in isolation or together via `npm test`. The Expo `app` package is
 * intentionally excluded — it uses jest-expo (React Native preset) instead.
 */
const nodePackages = ["shared", "db", "pipeline", "api"] as const;

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      all: true,
      include: [
        "shared/src/**/*.ts",
        "db/src/**/*.ts",
        "pipeline/src/**/*.ts",
        "api/src/**/*.ts",
        "app/lib/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "**/*.gen.ts",
        "**/generated/**",
      ],
    },
    projects: [
      ...nodePackages.map((name) => ({
        test: {
          name,
          root: `./${name}`,
          environment: "node",
          include: ["test/**/*.test.ts", "src/**/*.test.ts"],
        },
      })),
      // The container supervisor. Its restart decision caused both of this
      // month's outages and had no tests at all; the pure policy is covered
      // here, the spawn plumbing around it is verified by hand.
      {
        test: {
          name: "deploy",
          root: "./deploy",
          environment: "node",
          include: ["test/**/*.test.mjs"],
        },
      },
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
