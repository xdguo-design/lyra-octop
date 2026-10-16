/**
 * Visual skins customize surfaces, panel geometry and typography independently
 * of the existing brand palette and light/dark preference.
 * Keep preview colors aligned with visual-skins.css.
 */
type SkinColors = {
  canvas: string;
  sidebar: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
};

type SkinDefinition = {
  id: string;
  radius: number;
  light: SkinColors;
  dark: SkinColors;
};

export const VISUAL_SKINS = [
  {
    id: "doodle", radius: 14,
    light: { canvas: "#faf3e4", sidebar: "#efe2c8", surface: "#fffdf6", text: "#3b3a36", muted: "#6b675c", border: "#cfc2a2", accent: "#e85d75" },
    dark: { canvas: "#111416", sidebar: "#22252a", surface: "#202429", text: "#f2f0ea", muted: "#b2ada3", border: "#4c4b46", accent: "#e8ad6e" },
  },
  {
    id: "cloud", radius: 18,
    light: { canvas: "#edf4ff", sidebar: "#e1edff", surface: "#ffffff", text: "#243b5d", muted: "#637c9b", border: "#d4e1f3", accent: "#5680dd" },
    dark: { canvas: "#111d33", sidebar: "#182944", surface: "#1c304a", text: "#edf5ff", muted: "#adc2df", border: "#334c6b", accent: "#88b6ff" },
  },
  {
    id: "forest", radius: 13,
    light: { canvas: "#eff4ec", sidebar: "#dfece3", surface: "#fcfdf8", text: "#24483b", muted: "#65796d", border: "#ceded2", accent: "#378a65" },
    dark: { canvas: "#0e1e19", sidebar: "#183329", surface: "#1b352c", text: "#eef7ee", muted: "#a8c5b3", border: "#365748", accent: "#78c7a0" },
  },
  {
    id: "orbit", radius: 16,
    light: { canvas: "#f0f3fd", sidebar: "#e0e6f7", surface: "#ffffff", text: "#283758", muted: "#667599", border: "#d3ddf2", accent: "#667bda" },
    dark: { canvas: "#0b1226", sidebar: "#101d38", surface: "#162744", text: "#e9f1ff", muted: "#9caed1", border: "#2d4266", accent: "#8aa3ff" },
  },
  {
    id: "journal", radius: 8,
    light: { canvas: "#f5efe4", sidebar: "#ece2d0", surface: "#fffaf1", text: "#45382c", muted: "#7e6c59", border: "#dacbb7", accent: "#a06e4b" },
    dark: { canvas: "#211c19", sidebar: "#2b241e", surface: "#302920", text: "#f3e5ce", muted: "#c0a98b", border: "#594a39", accent: "#deb27b" },
  },
  {
    id: "terminal", radius: 4,
    light: { canvas: "#e9f2ed", sidebar: "#d8e8dd", surface: "#f8fffa", text: "#143b2d", muted: "#527a67", border: "#b9d4c5", accent: "#207953" },
    dark: { canvas: "#0b1613", sidebar: "#10221b", surface: "#142b22", text: "#d9fae1", muted: "#80b69a", border: "#2a5843", accent: "#68e19a" },
  },
] as const satisfies readonly SkinDefinition[];

export type VisualSkin = (typeof VISUAL_SKINS)[number]["id"];
export const DEFAULT_SKIN: VisualSkin = "doodle";

export function isVisualSkin(value: unknown): value is VisualSkin {
  return typeof value === "string" &&
    VISUAL_SKINS.some((item) => item.id === value);
}

/** Ant Design surfaces must match the CSS theme variables, not the old hardcoded white/gray. */
export function skinAntdTokens(skin: VisualSkin, isDark: boolean) {
  const definition = VISUAL_SKINS.find((item) => item.id === skin) ?? VISUAL_SKINS[0];
  const color = isDark ? definition.dark : definition.light;
  return {
    borderRadius: definition.radius,
    colorBgBase: color.surface,
    colorBgContainer: color.surface,
    colorBgElevated: color.surface,
    colorBgLayout: color.canvas,
    colorTextBase: color.text,
    colorText: color.text,
    colorTextSecondary: color.muted,
    colorBorder: color.border,
    colorBorderSecondary: color.border,
  };
}
