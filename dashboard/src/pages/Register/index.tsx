import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Button } from "antd";
import { message } from "@/utils/antdMessage";

import { User, Lock, IdCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clearAuthToken } from "../../api";
import { authApi } from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import { applyGuestLocale } from "../../utils/locale";
import { useTheme } from "../../context/ThemeContext";
import CaptchaField, { type CaptchaFieldHandle } from "../Login/CaptchaField";
import { type PublicCaptchaConfig } from "../Login/captchaAdapters";

export default function RegisterPage() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [captchaReady, setCaptchaReady] = useState(false);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captcha, setCaptcha] = useState<PublicCaptchaConfig>({
    provider: "slider",
  });
  const captchaRef = useRef<CaptchaFieldHandle>(null);

  useEffect(() => {
    void applyGuestLocale();
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.setup_required) {
          clearAuthToken();
          navigate("/setup", { replace: true });
          return;
        }
        authApi
          .getCaptcha()
          .then((next) => {
            if (!cancelled) setCaptcha(next);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const resetCaptcha = () => {
    setCaptchaResetKey((n) => n + 1);
    setCaptchaReady(false);
  };

  const handleRegister = async () => {
    if (!username || !password || !captchaReady) return;
    if (password !== confirmPassword) {
      message.error(t("register.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const token = await captchaRef.current?.getToken();
      await authApi.register({
        username: username.trim(),
        password,
        display_name: displayName.trim() || null,
        captcha_token: token,
      });
      setDone(true);
    } catch (err) {
      message.error(apiErrorMessage(err, t("register.failed"), t));
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(24px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(24px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px))",
        background: "var(--fn-bg-layout)",
        transition: "background var(--fn-transition)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          padding: "48px 32px 40px",
          background: "var(--fn-bg-elevated)",
          borderRadius: 16,
          boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
          border: "1px solid var(--fn-border-primary)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          margin: "0 16px",
        }}
      >
        <img
          src={
            isDark ? "/logo_horizontal_white.png" : "/logo_horizontal_dark.png"
          }
          alt="Octop"
          style={{
            height: 48,
            width: "auto",
            maxWidth: 260,
            objectFit: "contain",
            display: "block",
          }}
        />

        {done ? (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--fn-text-primary)",
                margin: 0,
                textAlign: "center",
              }}
            >
              {t("register.submittedTitle")}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--fn-text-tertiary)",
                textAlign: "center",
              }}
            >
              {t("register.submittedHint", { username })}
            </p>
            <Button
              type="primary"
              size="large"
              block
              onClick={() => navigate("/login", { replace: true })}
              style={{ borderRadius: 10, height: 44, fontWeight: 500 }}
            >
              {t("register.backToLogin")}
            </Button>
          </>
        ) : (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--fn-text-primary)",
                margin: 0,
                textAlign: "center",
              }}
            >
              {t("register.title")}
            </h2>

            <Input
              prefix={
                <User
                  size={16}
                  style={{ color: "var(--fn-text-quaternary)" }}
                />
              }
              placeholder={t("register.username")}
              size="large"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              style={{ borderRadius: 10 }}
            />

            <Input
              prefix={
                <IdCard
                  size={16}
                  style={{ color: "var(--fn-text-quaternary)" }}
                />
              }
              placeholder={t("register.displayName")}
              size="large"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ borderRadius: 10 }}
            />

            <Input.Password
              prefix={
                <Lock
                  size={16}
                  style={{ color: "var(--fn-text-quaternary)" }}
                />
              }
              placeholder={t("register.password")}
              size="large"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ borderRadius: 10 }}
            />

            <Input.Password
              prefix={
                <Lock
                  size={16}
                  style={{ color: "var(--fn-text-quaternary)" }}
                />
              }
              placeholder={t("register.confirmPassword")}
              size="large"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{ borderRadius: 10 }}
            />

            <CaptchaField
              ref={captchaRef}
              config={captcha}
              resetKey={captchaResetKey}
              slideHint={t("login.slideHint")}
              slideVerifiedLabel={t("login.slideVerified")}
              unsupportedLabel={t("login.unsupportedCaptcha")}
              onReadyChange={setCaptchaReady}
            />

            <Button
              type="primary"
              size="large"
              block
              loading={loading}
              onClick={handleRegister}
              disabled={
                !username || !password || !confirmPassword || !captchaReady
              }
              style={{ borderRadius: 10, height: 44, fontWeight: 500 }}
            >
              {t("register.submit")}
            </Button>

            <button
              type="button"
              data-testid="register-back-to-login"
              onClick={() => navigate("/login")}
              style={{
                margin: 0,
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--fn-text-tertiary)",
              }}
            >
              {t("register.backToLogin")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
