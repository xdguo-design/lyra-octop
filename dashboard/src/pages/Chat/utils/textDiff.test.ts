import { describe, expect, it } from "vitest";
import { diffTextLines } from "./textDiff";

describe("diffTextLines", () => {
  it("marks inserted and removed lines while preserving shared lines", () => {
    expect(
      diffTextLines("before\nshared\nlocal", "before\nshared\nremote"),
    ).toEqual([
      { kind: "same", text: "before" },
      { kind: "same", text: "shared" },
      { kind: "removed", text: "local" },
      { kind: "added", text: "remote" },
    ]);
  });

  it("aligns unchanged lines across insertions", () => {
    expect(diffTextLines("a\nb", "x\na\nb")).toEqual([
      { kind: "added", text: "x" },
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("falls back instead of allocating an unbounded diff matrix", () => {
    expect(diffTextLines("a\n".repeat(1_001), "b\n".repeat(1_001))).toBeNull();
    expect(diffTextLines("x".repeat(200_001), "")).toBeNull();
  });
});
