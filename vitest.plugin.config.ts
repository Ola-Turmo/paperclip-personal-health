import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/plugin.spec.ts"],
    exclude: ["tests/smoke.test.mjs"],
    environment: "node",
    globals: true,
  },
});
