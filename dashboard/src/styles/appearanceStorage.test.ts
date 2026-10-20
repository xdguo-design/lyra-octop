import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SKIN } from "./visualSkins";
import {
  loadAppearanceOnBoot,
  readStoredAppearance,
  writeStoredAppearance,
} from "./appearanceStorage";
import {
  DEFAULT_CUSTOM_COLOR,
  DEFAULT_PALETTE,
  LEGACY_PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./themePalettes";

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem(LEGACY_PALETTE_STORAGE_KEY);
});

describe("appearanceStorage", () => {
  it("defaults to system preference and rose palette", () => {
    expect(readStoredAppearance().preference).toBe("system");
    expect(readStoredAppearance().palette).toBe(DEFAULT_PALETTE);
    expect(readStoredAppearance().skin).toBe(DEFAULT_SKIN);
    expect(readStoredAppearance().skinExplicit).toBe(false);
  });

  it("migrates legacy plain theme string + palette key", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "tech");

    const appearance = readStoredAppearance();
    expect(appearance.preference).toBe("dark");
    expect(appearance.palette).toBe("tech");
  });

  it("reads unified JSON under the theme key", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "indigo" }),
    );

    const appearance = readStoredAppearance();
    expect(appearance.preference).toBe("light");
    expect(appearance.palette).toBe("indigo");
  });

  it("reads the custom palette with its brand hex", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        preference: "light",
        palette: "custom",
        customColor: "#AB5E50",
      }),
    );

    const appearance = readStoredAppearance();
    expect(appearance.palette).toBe("custom");
    expect(appearance.customColor).toBe("#ab5e50");
  });

  it("falls back to the default custom color on invalid hex", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        preference: "light",
        palette: "custom",
        customColor: "not-a-color",
      }),
    );

    expect(readStoredAppearance().customColor).toBe(DEFAULT_CUSTOM_COLOR);
  });

  it("writes preference and palette as different fields in the same key", () => {
    writeStoredAppearance({ preference: "system", palette: "teal" });
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "should-be-removed");

    writeStoredAppearance({
      preference: "light",
      palette: "custom",
      customColor: "#00AA55",
    });

    expect(localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      preference: "light",
      palette: "custom",
      customColor: "#00aa55",
      skin: null,
      skinExplicit: false,
    });
  });

  it("loadAppearanceOnBoot migrates legacy keys into unified JSON", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "amber");

    const appearance = loadAppearanceOnBoot();
    expect(appearance.preference).toBe("dark");
    expect(appearance.palette).toBe("amber");
    expect(localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      preference: "dark",
      palette: "amber",
      customColor: DEFAULT_CUSTOM_COLOR.toLowerCase(),
      skin: null,
      skinExplicit: false,
    });
  });

  it("round-trips a selected skin without changing the existing palette", () => {
    writeStoredAppearance({
      preference: "dark",
      palette: "tech",
      skin: "orbit",
    });
    const saved = readStoredAppearance();
    expect(saved.skin).toBe("orbit");
    expect(saved.palette).toBe("tech");
    expect(saved.preference).toBe("dark");
  });

  it("migrates an old automatic Doodle default but preserves an explicit selection", () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ skin: "doodle" }));
    expect(loadAppearanceOnBoot().skin).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!).skin,
    ).toBeNull();

    writeStoredAppearance({
      preference: "system",
      palette: "tech",
      skin: "doodle",
      skinExplicit: true,
    });
    expect(readStoredAppearance().skin).toBe("doodle");
  });

  it("handles unknown skins without crashing or applying unsupported CSS", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        skin: "unlisted",
        palette: "rose",
        preference: "light",
      }),
    );
    expect(readStoredAppearance().skin).toBe(DEFAULT_SKIN);
  });

  it("falls back safely on invalid JSON or unknown values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "{not-json");
    expect(readStoredAppearance().preference).toBe("system");
    expect(readStoredAppearance().palette).toBe(DEFAULT_PALETTE);

    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "neon", palette: "pink" }),
    );
    expect(readStoredAppearance().preference).toBe("system");
    expect(readStoredAppearance().palette).toBe(DEFAULT_PALETTE);
  });
});
