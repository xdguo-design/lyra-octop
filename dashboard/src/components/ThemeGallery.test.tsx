import type { PropsWithChildren } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  palette: "rose",
  skin: "doodle",
  customColor: "#4b74fa",
  isDark: false,
  setPalette: vi.fn(),
  setSkin: vi.fn(),
  setPreference: vi.fn(),
  setCustomColor: vi.fn(),
}));

vi.mock("../context/ThemeContext", () => ({ useTheme: () => theme }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const skinNames: Record<string, string> = {
        "account.skin.doodle": "手绘纸感",
        "account.skin.cloud": "云海玻璃",
        "account.skin.forest": "松林呼吸",
        "account.skin.orbit": "星轨蓝调",
        "account.skin.journal": "纸墨书房",
        "account.skin.terminal": "终端矩阵",
      };
      return skinNames[key] ?? fallback ?? key;
    },
  }),
}));
vi.mock("antd", () => ({
  ColorPicker: ({
    children,
    onChangeComplete,
  }: PropsWithChildren<{
    onChangeComplete: (color: { toHexString: () => string }) => void;
  }>) => (
    <div>
      {children}
      <button type="button" aria-label="pick-custom"
        onClick={() => onChangeComplete({ toHexString: () => "#123456" })}
      >pick</button>
    </div>
  ),
}));

import ThemeGallery from "./ThemeGallery";

describe("ThemeGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    theme.skin = "doodle";
    theme.palette = "rose";
    theme.preference = "system";
    theme.isDark = false;
  });

  it("lists all six real skins and exposes exactly one active skin", () => {
    render(<ThemeGallery />);
    const group = screen.getByRole("group", { name: "全部主题" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons).toHaveLength(6);
    for (const name of ["手绘纸感", "云海玻璃", "松林呼吸", "星轨蓝调", "纸墨书房", "终端矩阵"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "手绘纸感" })).toHaveAttribute("aria-pressed", "true");
    expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("switches a complete skin without changing palette or mode", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "松林呼吸" }));
    expect(theme.setSkin).toHaveBeenCalledWith("forest");
    expect(theme.setPalette).not.toHaveBeenCalled();
    expect(theme.setPreference).not.toHaveBeenCalled();
  });

  it("retains all eight brand palettes and custom hex", () => {
    render(<ThemeGallery />);
    for (const key of ["rose", "tech", "indigo", "teal", "violet", "emerald", "amber", "slate"]) {
      expect(screen.getByRole("button", { name: `header.palette.${key}` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "header.palette.teal" }));
    expect(theme.setPalette).toHaveBeenCalledWith("teal");
    fireEvent.click(screen.getByRole("button", { name: "pick-custom" }));
    expect(theme.setCustomColor).toHaveBeenCalledWith("#123456");
  });

  it("switches light/dark mode independently of the skin", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "header.themeDark" }));
    expect(theme.setPreference).toHaveBeenCalledWith("dark");
    expect(theme.setSkin).not.toHaveBeenCalled();
  });

  it("restores skin, brand palette and system mode together", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认主题" }));
    expect(theme.setSkin).toHaveBeenCalledWith("doodle");
    expect(theme.setPalette).toHaveBeenCalledWith("rose");
    expect(theme.setPreference).toHaveBeenCalledWith("system");
  });
});
