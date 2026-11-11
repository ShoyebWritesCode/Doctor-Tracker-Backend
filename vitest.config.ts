import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: { statements: 85, branches: 80, functions: 90, lines: 85 },
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});
