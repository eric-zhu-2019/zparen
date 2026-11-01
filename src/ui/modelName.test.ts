import { describe, expect, it } from "vitest";
import { modelName } from "./modelName";

describe("model names", () => {
  it("reads a model's id as its name", () => {
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelName("claude-fable-5-1")).toBe("Claude Fable 5.1");
    expect(modelName("claude-opus-5")).toBe("Claude Opus 5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelName("gpt-5.1")).toBe("GPT-5.1");
  });

  it("leaves an id it does not know as written", () => {
    expect(modelName("o3-mini")).toBe("o3-mini");
    expect(modelName("claude-opus-5-5[1m]")).toBe("claude-opus-5-5[1m]");
  });
});
