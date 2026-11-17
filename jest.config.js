// Fixed, fake API settings for tests (never the real .env.local values).
process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
process.env.EXPO_PUBLIC_API_KEY = 'test-key';

module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '\.css$': '<rootDir>/test/empty-module.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
