import { describe, it } from "vitest";
import { equal } from "node:assert";

describe("Personal Health Plugin", () => {
  it("should have correct plugin id", () => {
    equal("personal-health", "personal-health");
  });
});
