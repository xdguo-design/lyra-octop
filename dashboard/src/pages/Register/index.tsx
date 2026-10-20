import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Button } from "antd";
import { message } from "@/utils/antdMessage";

import { Mail, KeyRound, Lock, IdCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clearAuthToken } from "../../api";
import { authApi } from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import { applyGuestLocale } from "../../utils/locale";
import CaptchaField, { type CaptchaFieldHandle } from "../Login/CaptchaField";
import { type PublicCaptchaConfig } from "../Login/captchaAdapters";

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
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
  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCodeCooldown((remaining) => Math.max(0, remaining - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

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
    if (
      !normalizedEmail ||
      !emailCode ||
      sentEmail !== normalizedEmail ||
      !password
    )
      return;
    if (password !== confirmPassword) {
      message.error(t("register.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await authApi.register({
        email: normalizedEmail,
        email_code: emailCode,
        password,
        display_name: displayName.trim() || null,
      });
      setDone(true);
    } catch (err) {
      message.error(apiErrorMessage(err, t("register.failed"), t));
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!normalizedEmail || !captchaReady || codeCooldown > 0) return;
    setSendingCode(true);
    try {
      const token = await captchaRef.current?.getToken();
      await authApi.sendRegistrationCode(normalizedEmail, token);
      setSentEmail(normalizedEmail);
      setEmailCode("");
      setCodeCooldown(60);
      message.success(t("register.codeSent"));
      resetCaptcha();
    } catch (err) {
      message.error(apiErrorMessage(err, t("register.codeSendFailed"), t));
      resetCaptcha();
    } finally {
      setSendingCode(false);
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
        <div
          role="img"
          aria-label="LYRA 私有云工作台"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <img
            src="/lyra-dino.svg"
            alt=""
            style={{
              height: 56,
              width: 56,
              objectFit: "contain",
              display: "block",
            }}
          />
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
              color: "var(--fn-text-primary)",
              fontSize: 25,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "0.02em",
            }}
          >
            LYRA
            <small
              style={{
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.3,
                letterSpacing: "0.08em",
                color: "var(--fn-text-tertiary)",
              }}
            >
              私有云工作台
            </small>
          </span>
        </div>

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
              {t("register.submittedHint", {
                email: sentEmail || normalizedEmail,
              })}
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
                <Mail
                  size={16}
                  style={{ color: "var(--fn-text-quaternary)" }}
                />
              }
              placeholder={t("register.email")}
              type="email"
              maxLength={254}
              size="large"
              value={email}
              onChange={(e) => {
                const nextEmail = e.target.value;
                setEmail(nextEmail);
                if (nextEmail.trim().toLowerCase() !== sentEmail) {
                  setSentEmail("");
                  setEmailCode("");
                  setCodeCooldown(0);
                }
              }}
              autoFocus
              style={{ borderRadius: 10 }}
            />

            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <Input
                prefix={
                  <KeyRound
                    size={16}
                    style={{ color: "var(--fn-text-quaternary)" }}
                  />
                }
                placeholder={t("register.emailCode")}
                inputMode="numeric"
                maxLength={6}
                size="large"
                value={emailCode}
                onChange={(e) =>
                  setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                style={{ borderRadius: 10, flex: 1, minWidth: 0 }}
              />
              <Button
                size="large"
                loading={sendingCode}
                disabled={!normalizedEmail || !captchaReady || codeCooldown > 0}
                onClick={() => void handleSendCode()}
                style={{ borderRadius: 10, flexShrink: 0 }}
              >
                {codeCooldown > 0
                  ? t("register.resendCountdown", { seconds: codeCooldown })
                  : t("register.sendCode")}
              </Button>
            </div>

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
                !normalizedEmail ||
                emailCode.length !== 6 ||
                sentEmail !== normalizedEmail ||
                !password ||
                !confirmPassword
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
