// Only *.test.tsx: lib/ *.test.ts belongs to the root Vitest workspace, and
// matching both would double-run it.
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/?(*.)+(test).tsx"],
  moduleNameMapper: {
    "^@njt/shared$": "<rootDir>/../shared/src/index.ts",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|expo-router|expo-modules-core|react-native-svg|react-native-safe-area-context))",
  ],
};
