import { equal, ok } from "node:assert";

const manifestPath = new URL("../dist/manifest.js", import.meta.url);

try {
  const manifest = await import(manifestPath.href);
  ok(manifest.default, "Manifest should have a default export");
  equal(manifest.default.id, "personal-health", "Plugin ID should be personal-health");
  console.log("✅ Smoke test passed");
} catch (err) {
  console.error("❌ Smoke test failed — dist not built:", err.message);
  process.exit(1);
}
