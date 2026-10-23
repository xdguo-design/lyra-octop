// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  voiceInput: {
    onText: (_text: string) => undefined,
    onStart: () => undefined,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
    recording: false,
    transcribing: false,
  },
  speak: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../api/modules/admissionDemo", () => ({
  admissionDemoApi: { extract: mocks.extract },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      [key, ...Object.values(options || {})].join(" "),
    i18n: { language: "zh-CN" },
  }),
}));
vi.mock("../../hooks/useVoiceInput", () => ({
  useVoiceInput: (options: { onText: (text: string) => void }) => {
    mocks.voiceInput.onText = options.onText;
    mocks.voiceInput.onStart = options.onStart ?? (() => undefined);
    return {
      recording: mocks.voiceInput.recording,
      transcribing: mocks.voiceInput.transcribing,
      start: mocks.voiceInput.start,
      stop: mocks.voiceInput.stop,
      toggle: mocks.voiceInput.toggle,
    };
  },
}));
vi.mock("../../hooks/useVoiceConfig", () => ({
  prefetchVoiceConfig: vi.fn(),
}));
vi.mock("../../context/VoiceOutputContext", () => ({
  useVoiceOutputContext: () => ({
    speak: mocks.speak,
    stop: mocks.stop,
    speakingId: null,
  }),
}));

import AdmissionDemoPage from ".";

const RECOGNIZE = "admissionDemo.simulateRecognition";

function renderPage() {
  return render(
    <MemoryRouter>
      <AdmissionDemoPage />
    </MemoryRouter>,
  );
}

function verifyIdentity() {
  fireEvent.click(screen.getByRole("button", { name: RECOGNIZE }));
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.voiceInput.recording = false;
  mocks.voiceInput.transcribing = false;
});

describe("admission demo kiosk flow", () => {
  it("returns to identity recognition from the admission flow", async () => {
    renderPage();
    const returnHome = screen.getByRole("button", {
      name: /admissionDemo.backHome/,
    });
    expect(screen.queryByText("张三")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();

    expect(
      screen.getByRole("button", { name: /admissionDemo.idCard/ }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const method of ["healthCard", "qrIdentify", "faceIdentify"]) {
      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp(`admissionDemo.${method}`),
        }),
      );
      expect(
        screen.getByRole("button", {
          name: new RegExp(`admissionDemo.${method}`),
        }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByText("张三")).toBeNull();
    }

    verifyIdentity();
    await waitFor(
      () => expect(screen.getByText("admissionDemo.applicationTitle")),
      { timeout: 4000 },
    );
    fireEvent.click(returnHome);

    expect(screen.getByText("admissionDemo.identityTitle")).toBeTruthy();
    expect(screen.queryByText("张三")).toBeNull();
    expect(
      screen.getByRole("button", { name: /admissionDemo.idCard/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("moves through identity lookup into the application confirmation", async () => {
    renderPage();
    verifyIdentity();

    expect(screen.getByText("admissionDemo.queryTitle")).toBeTruthy();
    expect(screen.getByText("张三")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "admissionDemo.patientPhotoAlt" }),
    ).toHaveAttribute("src", "/admission-demo/patient-portrait.webp");
    expect(screen.getAllByText(/admissionDemo.admissionSearching/).length).toBe(
      1,
    );

    await waitFor(
      () =>
        expect(screen.getByText("admissionDemo.applicationTitle")).toBeTruthy(),
      { timeout: 4000 },
    );
    expect(screen.getByText("RY202610160018")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );
    expect(screen.getByText("admissionDemo.detailsTitle")).toBeTruthy();
  });

  it("reads the application only after the patient clicks the read button", async () => {
    renderPage();
    verifyIdentity();

    const readButton = await screen.findByRole(
      "button",
      { name: "admissionDemo.readApplication" },
      { timeout: 4000 },
    );
    expect(mocks.speak).not.toHaveBeenCalled();

    fireEvent.click(readButton);

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    const [, spokenText] = mocks.speak.mock.calls[0];
    expect(spokenText).toContain("RY202610160018");
    expect(spokenText).toContain("呼吸内科");
    expect(spokenText).toContain("admissionDemo.awaitingConfirmation");
  });

  it("keeps patient data hidden behind the SMS fallback until the demo code is verified", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.smsFallback/ }),
    );
    const phoneInput = screen.getByPlaceholderText(
      "admissionDemo.phonePlaceholder",
    );
    fireEvent.change(phoneInput, { target: { value: "13900139000" } });
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.sendCode" }),
    );
    expect(screen.queryByText("张三")).toBeNull();

    fireEvent.change(phoneInput, { target: { value: "13800005678" } });
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.sendCode" }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("admissionDemo.codePlaceholder"),
      { target: { value: "000000" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.verify" }),
    );
    expect(screen.queryByText("张三")).toBeNull();

    fireEvent.change(
      screen.getByPlaceholderText("admissionDemo.codePlaceholder"),
      { target: { value: "123456" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.verify" }),
    );
    expect(screen.getByText("张三")).toBeTruthy();
  });

  it("collects the required details and submits only after both acknowledgements", async () => {
    mocks.extract.mockResolvedValue({
      fields: {
        emergency_contact: "王五",
        emergency_phone: "13900139000",
        relationship: "儿子",
        address: "北京市朝阳区示例路 8 号",
      },
    });
    renderPage();
    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
        ).toBeTruthy(),
      { timeout: 4000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /admissionDemo.suggestionContactName/,
      }),
    );

    await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByDisplayValue("王五")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByDisplayValue("北京市朝阳区示例路 8 号")).toBeTruthy(),
    );
    expect(
      screen.getAllByText(/admissionDemo.pendingFill/).length,
    ).toBeGreaterThan(0);

    fireEvent.change(
      screen.getByPlaceholderText("admissionDemo.placeholders.emergency_phone"),
      { target: { value: "13900139000" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.confirmDetails" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /admissionDemo.feesAcknowledgment/,
      }),
    );
    expect(
      screen.getByRole("button", { name: /admissionDemo.submit/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /admissionDemo.insuranceAcknowledgment/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.submit/ }),
    );

    expect(await screen.findByText(/SIM-RY202610160018/)).toBeTruthy();
    expect(screen.getByText("admissionDemo.successTitle")).toBeTruthy();
    expect(screen.getByText("admissionDemo.followUpTitle")).toBeTruthy();
  }, 20000);

  it("answers quick chips on the application step: confirm, restart, or speak details", async () => {
    renderPage();
    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getAllByText(/admissionDemo.chipApplicationOne/).length,
        ).toBeGreaterThan(0),
      { timeout: 4000 },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /admissionDemo.chipApplicationThree/,
      }),
    );
    expect(mocks.speak).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.chipApplicationTwo/ }),
    );
    expect(screen.getByText("admissionDemo.identityTitle")).toBeTruthy();
  });

  it("shows recognized speech inline and sends it to AI after identity confirmation", async () => {
    mocks.extract.mockResolvedValue({
      fields: { emergency_contact: "王五", emergency_phone: "13900139000" },
    });
    renderPage();
    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
        ).toBeTruthy(),
      { timeout: 4000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.voiceInput" }),
    );
    act(() => mocks.voiceInput.onStart());
    act(() => mocks.voiceInput.onText("紧急联系人是王五，电话13900139000"));

    expect(
      screen.getByText("紧急联系人是王五，电话13900139000"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.extract).toHaveBeenCalledWith(
        "紧急联系人是王五，电话13900139000",
      ),
    );
    await waitFor(() => expect(mocks.speak).toHaveBeenCalled());
    const spokenText = mocks.speak.mock.calls
      .map(([, text]) => String(text))
      .join(" ");
    expect(spokenText).toContain("admissionDemo.phoneSpokenSuffix 9000");
    expect(spokenText).not.toContain("13900139000");
  });

  it("does not send a recording to AI if it started before identity confirmation", async () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.voiceInput" }),
    );
    act(() => mocks.voiceInput.onStart());

    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );
    act(() => mocks.voiceInput.onText("联系人电话是13800138000"));

    expect(screen.getByText("联系人电话是13800138000")).toBeInTheDocument();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the transcript visible and reports AI failure inline", async () => {
    mocks.extract.mockRejectedValue(new Error("model unavailable"));
    renderPage();
    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.voiceInput" }),
    );
    act(() => mocks.voiceInput.onStart());
    act(() => mocks.voiceInput.onText("紧急联系人电话13900139000"));

    expect(
      await screen.findByText("admissionDemo.modelFailure"),
    ).toBeInTheDocument();
    expect(screen.getByText("紧急联系人电话13900139000")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps manual entry available as a fallback", async () => {
    renderPage();
    verifyIdentity();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.isPatient/ }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /admissionDemo.manualInput/ }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stops speech output when voice capture starts and when the page unmounts", () => {
    const view = renderPage();
    const callsBeforeCapture = mocks.stop.mock.calls.length;
    act(() => mocks.voiceInput.onStart());
    expect(mocks.stop).toHaveBeenCalledTimes(callsBeforeCapture + 1);

    view.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(callsBeforeCapture + 2);
  });

  it("starts voice capture from the microphone on the first step", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.voiceInput" }),
    );
    expect(mocks.voiceInput.toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the prototype recording controls without inventing a waveform", () => {
    const view = renderPage();
    mocks.voiceInput.recording = true;
    view.rerender(
      <MemoryRouter>
        <AdmissionDemoPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "admissionDemo.endRecording" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".admission-waveform")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "admissionDemo.endRecording" }),
    );
    expect(mocks.voiceInput.stop).toHaveBeenCalledTimes(1);
  });
});
