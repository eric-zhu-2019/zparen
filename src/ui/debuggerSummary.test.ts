import { describe, expect, it } from "vitest";
import { codeParts, explainRequest, firstFrame, foldLabel, frameRows, localKind, parseSummary, restartGroups, staleFrames, type SummaryFrame, type SummaryRestart } from "./debuggerSummary";

const frame = (index: number, owner: SummaryFrame["owner"], more: Partial<SummaryFrame> = {}): SummaryFrame => ({
  index,
  call: `(f${index})`,
  owner,
  name: `f${index}`,
  restartable: true,
  stale: false,
  file: null,
  line: null,
  args: [],
  ...more,
});

const restart = (index: number, role: SummaryRestart["role"]): SummaryRestart => ({ index, role, label: `r${index}`, prompt: null });

describe("debugger summary", () => {
  it("marks code in a title", () => {
    expect(codeParts("`gret` is not defined")).toEqual([
      { text: "gret", code: true },
      { text: " is not defined", code: false },
    ]);
    expect(codeParts("Division by zero")).toEqual([{ text: "Division by zero", code: false }]);
  });

  it("reads only a summary", () => {
    expect(parseSummary("not json")).toBeNull();
    expect(parseSummary('{"title":"x"}')).toBeNull();
    expect(parseSummary('{"title":"x","frames":[],"restarts":[]}')?.title).toBe("x");
  });

  it("shows abort first, the program's restarts next, Swank's retry last, and Swank's own under More", () => {
    const g = restartGroups([restart(0, "continue"), restart(1, "value"), restart(2, "retry"), restart(3, "abort"), restart(4, "internal"), restart(5, "other")]);
    expect(g.abort?.index).toBe(3);
    expect(g.main.map((r) => r.index)).toEqual([0, 1, 5, 2]);
    expect(g.more.map((r) => r.index)).toEqual([4]);
  });

  it("folds the frames that are not the user's", () => {
    const frames = [frame(0, "system"), frame(1, "yours"), frame(2, "system"), frame(3, "library"), frame(4, "yours"), frame(5, "system")];
    const rows = frameRows(frames);
    expect(rows.map((r) => (r.kind === "frame" ? r.frame.index : r.key))).toEqual(["0-0", 1, "2-3", 4, "5-5"]);
    const fold = rows[2];
    expect(fold.kind === "fold" && foldLabel(fold)).toBe("2 other frames");
    const fold0 = rows[0];
    expect(fold0.kind === "fold" && foldLabel(fold0)).toBe("1 SBCL and Swank frame");
    expect(frameRows(frames, new Set(["2-3"])).map((r) => (r.kind === "frame" ? r.frame.index : r.key)), "an opened fold shows its frames").toEqual(["0-0", 1, 2, 3, 4, "5-5"]);
  });

  it("shows a library's frames when none are the user's, and every frame when there is only the system", () => {
    expect(frameRows([frame(0, "system"), frame(1, "library"), frame(2, "system")]).map((r) => (r.kind === "frame" ? r.frame.index : r.key))).toEqual(["0-0", 1, "2-2"]);
    expect(frameRows([frame(0, "system"), frame(1, "system")]).map((r) => r.kind)).toEqual(["frame", "frame"]);
  });

  it("opens the user's innermost frame first, and finds frames that run an old definition", () => {
    const frames = [frame(0, "system"), frame(1, "yours", { stale: true }), frame(2, "yours", { stale: true, restartable: false })];
    expect(firstFrame(frames)?.index).toBe(1);
    expect(firstFrame([frame(0, "system")])).toBeNull();
    expect(staleFrames(frames).map((f) => f.index)).toEqual([1]);
  });

  it("tells arguments from locals and compiler temporaries", () => {
    expect(localKind("NAME", ["name"])).toBe("arg");
    expect(localKind("COUNT", ["name"])).toBe("local");
    expect(localKind("#:G2", ["name"])).toBe("temp");
    expect(localKind("ZEN-DEMO::NAME", ["name"]), "Swank prints a name from another package with its prefix").toBe("arg");
  });

  it("asks the assistant with the condition and the user's frames, by paths in the project", () => {
    const dbg = { thread: "repl", level: 1, condition: "The value \"5\" is not of type NUMBER", conditionType: "", restarts: [], frames: [], stepping: false } as never;
    const text = explainRequest(dbg, { level: 1, kind: "error", title: "Expected a number", detail: null, suggestions: [], define: null, restarts: [], frames: [frame(1, "yours", { call: '(add-one "5")', file: "/p/demo/src/main.lisp", line: 10 })] }, "/p/demo/");
    expect(text).toContain("Expected a number");
    expect(text).toContain('- (add-one "5") (src/main.lisp:10)');
  });
});
