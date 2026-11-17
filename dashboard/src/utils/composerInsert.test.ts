import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingComposerInsert,
  insertComposerText,
  resetComposerInsert,
  subscribeComposerInsert,
} from "./composerInsert";

describe("composerInsert", () => {
  afterEach(() => {
    resetComposerInsert();
  });

  it("delivers text to every subscribed composer", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeComposerInsert(first);
    subscribeComposerInsert(second);

    expect(insertComposerText("hello")).toBe(true);
    expect(first).toHaveBeenCalledWith("hello");
    expect(second).toHaveBeenCalledWith("hello");
  });

  it("buffers text while no composer is mounted and flushes once", () => {
    expect(insertComposerText("first")).toBe(false);
    expect(insertComposerText("second")).toBe(false);

    expect(consumePendingComposerInsert()).toBe("first\n\nsecond");
    expect(consumePendingComposerInsert()).toBe("");
  });

  it("ignores blank text", () => {
    const listener = vi.fn();
    subscribeComposerInsert(listener);

    expect(insertComposerText("   ")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(consumePendingComposerInsert()).toBe("");
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposerInsert(listener);
    unsubscribe();

    expect(insertComposerText("hello")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
