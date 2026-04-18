import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";

describe("manifest", () => {
  it("uses the personal-health plugin id", () => {
    expect(manifest.id).toBe("personal-health");
  });
});
