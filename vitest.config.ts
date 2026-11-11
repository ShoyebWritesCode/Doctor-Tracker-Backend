import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      exclude: ["dist/**", "tests/**"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});
