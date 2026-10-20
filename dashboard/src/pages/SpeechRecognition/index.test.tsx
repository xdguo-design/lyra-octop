// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import zh from "../../locales/zh.json";

const mocks = vi.hoisted(() => ({
  translations: {} as Record<string, unknown>,
  provider: "doubao",
  failConfig: false,
  t: (key: string, options?: Record<string, string>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (current, part) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
        mocks.translations,
      );
    return typeof value === "string"
      ? value.replace(/{{(\w+)}}/g, (_, name: string) => options?.[name] ?? "")
      : key;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock("../../api/modules/voice", () => ({
  voiceApi: {
    getActive: vi.fn(() =>
      mocks.failConfig
        ? Promise.reject(new Error("config unavailable"))
        : Promise.resolve({ stt: mocks.provider, tts: "browser" }),
    ),
  },
}));

import SpeechRecognitionPage from "./index";

function LocationProbe() {
  const location = useLocation();
  return (
    <div>
      <span>path:{location.pathname}</span>
      <span>state:{JSON.stringify(location.state)}</span>
    </div>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/speech-recognition"]}>
      <Routes>
        <Route path="/speech-recognition" element={<SpeechRecognitionPage />} />
        <Route path="/chat" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SpeechRecognitionPage", () => {
  beforeEach(() => {
    Object.assign(mocks.translations, zh);
    mocks.provider = "doubao";
    mocks.failConfig = false;
  });

  afterEach(cleanup);

  it("shows the active provider", async () => {
    renderPage();
    expect(await screen.findByText("识别服务：doubao")).toBeTruthy();
  });

  it("enters the chat with autoVoice when the mic is clicked", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "开始说话" }));
    expect(await screen.findByText("path:/chat")).toBeTruthy();
    expect(screen.getByText(/^state:/).textContent).toBe(
      'state:{"autoVoice":true}',
    );
  });

  it("marks the provider unavailable when the config request fails", async () => {
    mocks.failConfig = true;
    renderPage();
    expect(await screen.findByText("无法读取识别服务")).toBeTruthy();
  });
});
