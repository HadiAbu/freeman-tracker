// Fixed, fake API settings for tests (never the real .env.local values).
process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
process.env.EXPO_PUBLIC_API_KEY = 'test-key';

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/test/setup.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-after-env.js'],
  // The first test in a file pays for transforming the whole React Native tree, which can
  // pass the 5 s default on a cold cache or under coverage instrumentation.
  testTimeout: 30_000,
  // Only used with --coverage (npm run test:ci). Types and test helpers are not product code.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/test-utils/**',
    '!src/types.ts',
  ],
  // A floor a few points under the current numbers (82 / 75 / 81 / 83): it fails CI when
  // coverage really drops, not on every refactor. Raise it as coverage grows.
  coverageThreshold: { global: { statements: 78, branches: 70, functions: 78, lines: 80 } },
  moduleNameMapper: {
    '\\.css$':'<rootDir>/test/empty-module.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
