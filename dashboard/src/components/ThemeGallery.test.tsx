import type { PropsWithChildren } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  palette: "rose",
  customColor: "#4b74fa",
  isDark: false,
  setPalette: vi.fn(),
  setPreference: vi.fn(),
  setCustomColor: vi.fn(),
}));

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => theme,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
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
      <button
        type="button"
        aria-label="pick-custom"
        onClick={() => onChangeComplete({ toHexString: () => "#123456" })}
      >
        pick
      </button>
    </div>
  ),
}));

import ThemeGallery from "./ThemeGallery";

describe("ThemeGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    theme.palette = "rose";
    theme.preference = "system";
    theme.isDark = false;
  });

  it("renders all eight real palettes and an accessible custom picker", () => {
    render(<ThemeGallery />);
    expect(
      screen.getByRole("group", { name: "全部主题" }),
    ).toBeInTheDocument();
    for (const key of [
      "rose",
      "tech",
      "indigo",
      "teal",
      "violet",
      "emerald",
      "amber",
      "slate",
    ]) {
      expect(screen.getByRole("button", { name: `header.palette.${key}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "header.palette.custom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "header.palette.rose" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "header.palette.tech" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("applies a curated palette using the shared theme context", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "header.palette.teal" }));
    expect(theme.setPalette).toHaveBeenCalledWith("teal");
  });

  it("switches display preference without changing the palette", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "header.themeDark" }));
    expect(theme.setPreference).toHaveBeenCalledWith("dark");
    expect(theme.setPalette).not.toHaveBeenCalled();
  });

  it("uses the existing custom hex path", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "pick-custom" }));
    expect(theme.setCustomColor).toHaveBeenCalledWith("#123456");
  });

  it("restores the default palette and system mode", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认主题" }));
    expect(theme.setPalette).toHaveBeenCalledWith("rose");
    expect(theme.setPreference).toHaveBeenCalledWith("system");
  });
});
