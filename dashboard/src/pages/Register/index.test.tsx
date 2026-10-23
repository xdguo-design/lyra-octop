import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./index";

const { getAuthStatus, getCaptcha, captchaChallenge } = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getCaptcha: vi.fn(),
  captchaChallenge: vi.fn(),
}));

vi.mock("../../api/modules/auth", () => ({
  authApi: { getAuthStatus, getCaptcha, captchaChallenge },
}));
vi.mock("../../utils/locale", () => ({ applyGuestLocale: vi.fn() }));

describe("RegisterPage", () => {
  beforeEach(() => {
    getAuthStatus.mockResolvedValue({ setup_required: false });
    getCaptcha.mockResolvedValue({ provider: "image" });
    captchaChallenge.mockResolvedValue({
      challenge_id: "challenge",
      image: "data:image/png;base64,AA==",
    });
  });

  it("explains that the image captcha is required before sending an email code", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    const sendButton = screen.getByRole("button", {
      name: "register.sendCode",
    });
    expect(sendButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "register.captchaRequired",
    );

    await user.type(
      screen.getByPlaceholderText("register.email"),
      "person@example.com",
    );
    await waitFor(() =>
      expect(screen.getByTestId("captcha-image-input")).toBeInTheDocument(),
    );
    await user.type(screen.getByTestId("captcha-image-input"), "ABCD");

    await waitFor(() => expect(sendButton).toBeEnabled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
