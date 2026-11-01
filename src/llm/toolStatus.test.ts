import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, toolStatusLabel } from "./tools";

describe("toolStatusLabel", () => {
  it("describes every tool the model can call", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const label = toolStatusLabel(tool.function.name);
      expect(label, tool.function.name).not.toBe("Working…");
      expect(label.endsWith("…")).toBe(true);
    }
  });

  it("falls back for an unknown name instead of showing nothing", () => {
    expect(toolStatusLabel("rm_rf")).toBe("Working…");
  });
});
