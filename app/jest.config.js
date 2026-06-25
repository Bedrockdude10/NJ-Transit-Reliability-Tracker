// jest-expo runs component/render tests (files named *.test.tsx). Pure logic in
// lib/ is covered by the root Vitest workspace (*.test.ts), so jest only matches
// .test.tsx here to avoid double-running.
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
