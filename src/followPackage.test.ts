import { describe, expect, it } from "vitest";
import { filePackage, packageToFollow } from "./followPackage";
import type { Tab } from "./store";

const tab = (path: string, text: string) => ({ path, text }) as Tab;
const state = (text: string, over: Partial<{ packages: string[]; package: string; path: string }> = {}) => {
  const path = over.path ?? "/p/src/main.lisp";
  return { tabs: [tab(path, text)], activeTab: path, packages: over.packages ?? ["COMMON-LISP-USER", "MY-APP"], package: over.package ?? "COMMON-LISP-USER" };
};

describe("the REPL following the file being edited", () => {
  it("reads a Lisp file's package from its in-package", () => {
    expect(filePackage("/p/a.lisp", "(defpackage #:my-app (:use #:cl))\n(in-package #:my-app)\n(defun f ())")).toBe("MY-APP");
    expect(filePackage("/p/a.lisp", "(defun f ())")).toBeNull();
    expect(filePackage("/p/notes.md", "(in-package #:my-app)")).toBeNull();
  });

  it("switches to the file's package once, when Lisp has it", () => {
    const s = state("(in-package :my-app)");
    const next = packageToFollow(s, null);
    expect(next).toEqual({ key: "/p/src/main.lisp\nMY-APP", name: "MY-APP" });
    expect(packageToFollow(s, next!.key), "an in-package typed in the REPL then holds").toBeNull();
  });

  it("waits for a package Lisp does not have yet", () => {
    expect(packageToFollow(state("(in-package :not-loaded)"), null)).toBeNull();
    expect(packageToFollow(state("(in-package :not-loaded)", { packages: ["NOT-LOADED"] }), null)?.name).toBe("NOT-LOADED");
  });

  it("asks for nothing when the REPL is in the package already", () => {
    expect(packageToFollow(state("(in-package :my-app)", { package: "MY-APP" }), null)).toEqual({ key: "/p/src/main.lisp\nMY-APP", name: null });
  });
});
