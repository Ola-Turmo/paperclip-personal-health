import * as esbuild from "esbuild";

async function buildAll() {
  await esbuild.build({
    entryPoints: ["src/manifest.ts"],
    bundle: false,
    outfile: "dist/manifest.js",
    format: "esm",
    platform: "node",
    target: "node18",
  });

  await esbuild.build({
    entryPoints: ["src/worker.ts"],
    bundle: true,
    outfile: "dist/worker.js",
    format: "esm",
    platform: "node",
    target: "node18",
    external: ["react", "react-dom"],
    logLevel: "info",
  });

  console.log("✅ Build complete");
}

buildAll().catch(e => { console.error(e); process.exit(1); });
