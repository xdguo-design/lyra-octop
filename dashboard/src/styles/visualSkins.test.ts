import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN,
  VISUAL_SKINS,
  isVisualSkin,
  skinAntdTokens,
} from "./visualSkins";

describe("visual skin catalog", () => {
  it("contains unique supported skin identifiers", () => {
    expect(new Set(VISUAL_SKINS.map((item) => item.id)).size).toBe(
      VISUAL_SKINS.length,
    );
    expect(VISUAL_SKINS).toHaveLength(13);
    expect(VISUAL_SKINS.every((skin) => skin.image && skin.galleryKey)).toBe(
      true,
    );
    expect(new Set(VISUAL_SKINS.map((skin) => skin.galleryKey)).size).toBe(13);
    expect(DEFAULT_SKIN).toBeNull();
    expect(isVisualSkin("unknown")).toBe(false);
  });

  it.each(VISUAL_SKINS)(
    "provides coherent Ant Design tokens for $id in both modes",
    (skin) => {
      for (const dark of [false, true]) {
        const resolved = dark ? skin.dark : skin.light;
        const tokens = skinAntdTokens(skin.id, dark);
        expect(tokens.colorBgContainer).toBe(resolved.surface);
        expect(tokens.colorBgLayout).toBe(resolved.canvas);
        expect(tokens.colorTextBase).toBe(resolved.text);
        expect(tokens.borderRadius).toBe(skin.radius);
      }
    },
  );
});
