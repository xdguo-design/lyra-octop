import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authApi, error } = vi.hoisted(() => ({
  authApi: {
    getAuthStatus: vi.fn(),
    getOauthStatus: vi.fn(),
    getLdapStatus: vi.fn(),
    getCaptcha: vi.fn(),
    login: vi.fn(),
  },
  error: vi.fn(),
}));

vi.mock("../../api/modules/auth", () => ({ authApi }));
vi.mock("../../utils/antdMessage", () => ({ message: { error } }));
vi.mock("../../utils/locale", () => ({
  applyGuestLocale: vi.fn(),
  applyUserLocale: vi.fn(),
}));
vi.mock("../../i18n", () => ({ refreshServerLabels: vi.fn() }));
vi.mock("./CaptchaField", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(
      (
        { onReadyChange }: { onReadyChange: (ready: boolean) => void },
        ref: React.ForwardedRef<{ getToken: () => Promise<string> }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          getToken: async () => "captcha-token",
        }));
        React.useEffect(() => onReadyChange(true), [onReadyChange]);
        return null;
      },
    ),
  };
});

import LoginPage from "./index";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<div>setup page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Login failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.getAuthStatus.mockResolvedValue({ setup_required: false });
    authApi.getOauthStatus.mockResolvedValue({ providers: [] });
    authApi.getLdapStatus.mockResolvedValue({ enabled: false });
    authApi.getCaptcha.mockResolvedValue({ provider: "none" });
  });

  it("keeps the login form when the setup status probe is unavailable", async () => {
    authApi.getAuthStatus.mockRejectedValue(new Error("server unavailable"));
    renderLogin();

    expect(
      await screen.findByPlaceholderText(/login\.username|username/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("setup page")).not.toBeInTheDocument();
  });

  it("keeps entered credentials available after an authentication failure", async () => {
    authApi.login.mockRejectedValue(new Error("invalid credentials"));
    const user = userEvent.setup();
    renderLogin();

    const username = await screen.findByPlaceholderText(
      /login\.username|username/i,
    );
    const password = screen.getByPlaceholderText(/login\.password|password/i);
    await user.type(username, "alice");
    await user.type(password, "wrong-password");
    await user.click(
      screen.getByRole("button", { name: /login\.submit|sign in|log in/i }),
    );

    await waitFor(() =>
      expect(authApi.login).toHaveBeenCalledWith(
        "alice",
        "wrong-password",
        "captcha-token",
      ),
    );
    expect(username).toHaveValue("alice");
    expect(password).toHaveValue("wrong-password");
    expect(error).toHaveBeenCalled();
  });
});
