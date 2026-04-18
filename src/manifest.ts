import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "personal-health",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Personal Health",
  description: "Personal health management — medications, symptoms, workouts, sleep, nutrition, labs, wearables, and DNA",
  author: "turmo.dev",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
