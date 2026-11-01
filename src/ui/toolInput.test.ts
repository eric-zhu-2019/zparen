import { describe, expect, it } from "vitest";
import { toolInput } from "./toolInput";

describe("a tool call's input", () => {
  it("shows one argument as itself, not as JSON", () => {
    expect(toolInput('{"form":"(* 6 7)"}')).toBe("(* 6 7)");
  });

  it("shows several arguments one per line", () => {
    expect(toolInput('{"path":"src/main.lisp","line":3,"all":true}')).toBe("path: src/main.lisp\nline: 3\nall: true");
  });

  it("keeps input that is not an object of arguments", () => {
    expect(toolInput("not json")).toBe("not json");
    expect(toolInput("[1,2]")).toBe("[1,2]");
  });
});
