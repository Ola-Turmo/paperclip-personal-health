import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "personal-health",
  apiVersion: 1,
  version: "0.2.0",
  displayName: "Personal Health",
  description: "A single Paperclip command surface for medications, recovery, nutrition, wearables, and living genetic-health insights.",
  author: "turmo.dev",
  categories: ["automation"],
  capabilities: [
    "companies.read",
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
