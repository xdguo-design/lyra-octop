import { DEFAULT_SKIN, isVisualSkin, type VisualSkin } from "./visualSkins";
import {
  DEFAULT_CUSTOM_COLOR,
  DEFAULT_PALETTE,
  LEGACY_PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VALID_PALETTES,
  normalizeHexColor,
  type ThemePalette,
} from "./themePalettes";

export type ThemePreference = "system" | "light" | "dark";

export type StoredAppearance = {
  preference: ThemePreference;
  palette: ThemePalette;
  /** Independent visual skin, migrated from existing palettes. */
  skin?: VisualSkin;
  /** Brand hex for the "custom" palette; ignored for curated palettes. */
  customColor?: string;
};

const VALID_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

function isPreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" && (VALID_PREFERENCES as string[]).includes(value)
  );
}

function isPalette(value: unknown): value is ThemePalette {
  return (
    typeof value === "string" &&
    ([...VALID_PALETTES, "custom"] as string[]).includes(value)
  );
}

/** LYRA 统一品牌：历史存的 rose（Octop 上游默认）一律迁到 tech 蓝。 */
function normalizeLyraPalette(value: ThemePalette): ThemePalette {
  return value === "rose" ? "tech" : value;
}

function readLegacyPalette(): ThemePalette {
  const stored = localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY);
  if (isPalette(stored)) return normalizeLyraPalette(stored);
  return DEFAULT_PALETTE;
}

/**
 * Read light/dark preference + brand palette from the shared `theme` key.
 * Migrates legacy plain-string `theme` and `octop:ui-palette` values.
 */
export function readStoredAppearance(): StoredAppearance {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (!raw) {
    return {
      preference: "system",
      palette: readLegacyPalette(),
      skin: DEFAULT_SKIN,
      customColor: DEFAULT_CUSTOM_COLOR,
    };
  }

  // Legacy: plain preference string
  if (isPreference(raw)) {
    return {
      preference: raw,
      palette: readLegacyPalette(),
      skin: DEFAULT_SKIN,
      customColor: DEFAULT_CUSTOM_COLOR,
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const preference = isPreference(obj.preference)
        ? obj.preference
        : "system";
      const palette = normalizeLyraPalette(
        isPalette(obj.palette) ? obj.palette : readLegacyPalette(),
      );
      const customColor =
        normalizeHexColor(obj.customColor as string) ?? DEFAULT_CUSTOM_COLOR;
      const skin = isVisualSkin(obj.skin) ? obj.skin : DEFAULT_SKIN;
      return { preference, palette, skin, customColor };
    }
  } catch {
    // fall through
  }

  return {
    preference: "system",
    palette: readLegacyPalette(),
    skin: DEFAULT_SKIN,
    customColor: DEFAULT_CUSTOM_COLOR,
  };
}

/** Persist both fields under the same `theme` key; drop legacy palette key. */
export function writeStoredAppearance(appearance: StoredAppearance): void {
  localStorage.setItem(
    THEME_STORAGE_KEY,
    JSON.stringify({
      preference: appearance.preference,
      palette: appearance.palette,
      skin: isVisualSkin(appearance.skin) ? appearance.skin : DEFAULT_SKIN,
      customColor:
        normalizeHexColor(appearance.customColor ?? "") ?? DEFAULT_CUSTOM_COLOR,
    }),
  );
  localStorage.removeItem(LEGACY_PALETTE_STORAGE_KEY);
}

/** One-shot boot read + migrate for ThemeProvider initial state. */
export function loadAppearanceOnBoot(): StoredAppearance {
  const appearance = readStoredAppearance();
  writeStoredAppearance(appearance);
  return appearance;
}
