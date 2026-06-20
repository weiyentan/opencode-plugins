import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use tsx-like ESM transformation for TypeScript test files
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Timeout for async tool tests
    testTimeout: 10_000,
    // Clean mocks between tests
    clearMocks: true,
    restoreMocks: true,
  },
});
