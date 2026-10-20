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
  galleryKey: string;
  image: string;
  radius: number;
  light: SkinColors;
  dark: SkinColors;
};

export const VISUAL_SKINS = [
  {
    id: "doodle",
    galleryKey: "classicQQ",
    image: classicQQImage,
    radius: 14,
    light: {
      canvas: "#faf3e4",
      sidebar: "#efe2c8",
      surface: "#fffdf6",
      text: "#3b3a36",
      muted: "#6b675c",
      border: "#cfc2a2",
      accent: "#e85d75",
    },
    dark: {
      canvas: "#111416",
      sidebar: "#22252a",
      surface: "#202429",
      text: "#f2f0ea",
      muted: "#b2ada3",
      border: "#4c4b46",
      accent: "#e8ad6e",
    },
  },
  {
    id: "cloud",
    galleryKey: "breezy",
    image: breezyImage,
    radius: 18,
    light: {
      canvas: "#edf4ff",
      sidebar: "#e1edff",
      surface: "#ffffff",
      text: "#243b5d",
      muted: "#637c9b",
      border: "#d4e1f3",
      accent: "#5680dd",
    },
    dark: {
      canvas: "#111d33",
      sidebar: "#182944",
      surface: "#1c304a",
      text: "#edf5ff",
      muted: "#adc2df",
      border: "#334c6b",
      accent: "#88b6ff",
    },
  },
  {
    id: "forest",
    galleryKey: "together",
    image: togetherImage,
    radius: 13,
    light: {
      canvas: "#eff4ec",
      sidebar: "#dfece3",
      surface: "#fcfdf8",
      text: "#24483b",
      muted: "#65796d",
      border: "#ceded2",
      accent: "#378a65",
    },
    dark: {
      canvas: "#0e1e19",
      sidebar: "#183329",
      surface: "#1b352c",
      text: "#eef7ee",
      muted: "#a8c5b3",
      border: "#365748",
      accent: "#78c7a0",
    },
  },
  {
    id: "orbit",
    galleryKey: "ripple",
    image: rippleImage,
    radius: 16,
    light: {
      canvas: "#f0f3fd",
      sidebar: "#e0e6f7",
      surface: "#ffffff",
      text: "#283758",
      muted: "#667599",
      border: "#d3ddf2",
      accent: "#667bda",
    },
    dark: {
      canvas: "#0b1226",
      sidebar: "#101d38",
      surface: "#162744",
      text: "#e9f1ff",
      muted: "#9caed1",
      border: "#2d4266",
      accent: "#8aa3ff",
    },
  },
  {
    id: "journal",
    galleryKey: "peacekeeperAutumn",
    image: peacekeeperAutumnImage,
    radius: 8,
    light: {
      canvas: "#f5efe4",
      sidebar: "#ece2d0",
      surface: "#fffaf1",
      text: "#45382c",
      muted: "#7e6c59",
      border: "#dacbb7",
      accent: "#a06e4b",
    },
    dark: {
      canvas: "#211c19",
      sidebar: "#2b241e",
      surface: "#302920",
      text: "#f3e5ce",
      muted: "#c0a98b",
      border: "#594a39",
      accent: "#deb27b",
    },
  },
  {
    id: "terminal",
    galleryKey: "companion",
    image: companionImage,
    radius: 4,
    light: {
      canvas: "#e9f2ed",
      sidebar: "#d8e8dd",
      surface: "#f8fffa",
      text: "#143b2d",
      muted: "#527a67",
      border: "#b9d4c5",
      accent: "#207953",
    },
    dark: {
      canvas: "#0b1613",
      sidebar: "#10221b",
      surface: "#142b22",
      text: "#d9fae1",
      muted: "#80b69a",
      border: "#2a5843",
      accent: "#68e19a",
    },
  },
  {
    id: "clearSky",
    galleryKey: "clearSky",
    image: skyClearImage,
    radius: 18,
    light: {
      canvas: "#edf6ff",
      sidebar: "#dceafa",
      surface: "#ffffff",
      text: "#24415d",
      muted: "#637e98",
      border: "#c8ddef",
      accent: "#3789ce",
    },
    dark: {
      canvas: "#101f31",
      sidebar: "#182b40",
      surface: "#20364e",
      text: "#e8f4ff",
      muted: "#a7c1d8",
      border: "#36536f",
      accent: "#78baff",
    },
  },
  {
    id: "cloudSea",
    galleryKey: "cloudSea",
    image: skyCloudImage,
    radius: 18,
    light: {
      canvas: "#f2f4f8",
      sidebar: "#e2e8f0",
      surface: "#ffffff",
      text: "#344259",
      muted: "#728198",
      border: "#d4dce7",
      accent: "#738fb1",
    },
    dark: {
      canvas: "#1a202a",
      sidebar: "#232d3b",
      surface: "#2b3746",
      text: "#eef2f8",
      muted: "#b3bfce",
      border: "#414f60",
      accent: "#9bbbe0",
    },
  },
  {
    id: "greatWall",
    galleryKey: "greatWall",
    image: greatWallImage,
    radius: 14,
    light: {
      canvas: "#f4efe7",
      sidebar: "#e9ddcb",
      surface: "#fffaf2",
      text: "#493b2c",
      muted: "#806e59",
      border: "#d9c9b1",
      accent: "#a46b3f",
    },
    dark: {
      canvas: "#27221c",
      sidebar: "#342b21",
      surface: "#3b3024",
      text: "#f3e8d8",
      muted: "#c0aa8c",
      border: "#574735",
      accent: "#dda46b",
    },
  },
  {
    id: "mogaoCaves",
    galleryKey: "mogaoCaves",
    image: mogaoCavesImage,
    radius: 12,
    light: {
      canvas: "#f7eee2",
      sidebar: "#ecdbc4",
      surface: "#fff8ed",
      text: "#513a2b",
      muted: "#8a6b53",
      border: "#dfc7a8",
      accent: "#bd7040",
    },
    dark: {
      canvas: "#2b211c",
      sidebar: "#382a20",
      surface: "#443126",
      text: "#f6e7d5",
      muted: "#c5a78a",
      border: "#604632",
      accent: "#e69a60",
    },
  },
  {
    id: "changbaiMountain",
    galleryKey: "changbaiMountain",
    image: changbaiMountainImage,
    radius: 16,
    light: {
      canvas: "#edf4f3",
      sidebar: "#dce9e9",
      surface: "#fbfefd",
      text: "#2a4549",
      muted: "#678084",
      border: "#c8dcdd",
      accent: "#418a91",
    },
    dark: {
      canvas: "#111f25",
      sidebar: "#1a2b32",
      surface: "#23383f",
      text: "#e8f5f4",
      muted: "#a4c3c3",
      border: "#375158",
      accent: "#70c0bc",
    },
  },
  {
    id: "woodland",
    galleryKey: "woodland",
    image: woodlandImage,
    radius: 14,
    light: {
      canvas: "#eef3e9",
      sidebar: "#dfe9d8",
      surface: "#fbfdf8",
      text: "#2e4635",
      muted: "#6f806f",
      border: "#cbd9c4",
      accent: "#54834d",
    },
    dark: {
      canvas: "#17231b",
      sidebar: "#223126",
      surface: "#2c3b2e",
      text: "#edf5e9",
      muted: "#b0c1aa",
      border: "#435643",
      accent: "#8fbd79",
    },
  },
  {
    id: "bambooForest",
    galleryKey: "bambooForest",
    image: bambooForestImage,
    radius: 16,
    light: {
      canvas: "#edf5f0",
      sidebar: "#dcebe1",
      surface: "#fbfefc",
      text: "#25463a",
      muted: "#678477",
      border: "#c5dbce",
      accent: "#2f8568",
    },
    dark: {
      canvas: "#12231c",
      sidebar: "#1a3328",
      surface: "#234033",
      text: "#e7f5ec",
      muted: "#9fc2ad",
      border: "#365846",
      accent: "#69c29b",
    },
  },
] as const satisfies readonly SkinDefinition[];

export type VisualSkin = (typeof VISUAL_SKINS)[number]["id"];
export const DEFAULT_SKIN: VisualSkin | null = null;

export function isVisualSkin(value: unknown): value is VisualSkin {
  return (
    typeof value === "string" && VISUAL_SKINS.some((item) => item.id === value)
  );
}

/** Ant Design surfaces must match the CSS theme variables, not the old hardcoded white/gray. */
export function skinAntdTokens(skin: VisualSkin, isDark: boolean) {
  const definition =
    VISUAL_SKINS.find((item) => item.id === skin) ?? VISUAL_SKINS[0];
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
import breezyImage from "../assets/theme-gallery/breezy.jpg";
import classicQQImage from "../assets/theme-gallery/classic-qq.jpg";
import peacekeeperAutumnImage from "../assets/theme-gallery/peacekeeper-autumn.jpg";
import togetherImage from "../assets/theme-gallery/together.jpg";
import rippleImage from "../assets/theme-gallery/ripple.jpg";
import companionImage from "../assets/theme-gallery/companion.jpg";
import skyClearImage from "../assets/theme-gallery/sky-clear.jpg";
import skyCloudImage from "../assets/theme-gallery/sky-cloud.jpg";
import greatWallImage from "../assets/theme-gallery/great-wall.jpg";
import mogaoCavesImage from "../assets/theme-gallery/mogao-caves.jpg";
import changbaiMountainImage from "../assets/theme-gallery/changbai-mountain.jpg";
import woodlandImage from "../assets/theme-gallery/forest.jpg";
import bambooForestImage from "../assets/theme-gallery/bamboo-forest.jpg";
