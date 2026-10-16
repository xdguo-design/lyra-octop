import { createGlobalStyle } from "antd-style";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { lazy, Suspense, useEffect } from "react";
import DesktopWindowControls from "./components/DesktopWindowControls";
import {
  DesktopChromeProvider,
  useDesktopChrome,
} from "./hooks/useDesktopChrome";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LoginPage from "./pages/Login";
// Unified LYRA shell: all authenticated routes retain the same workbench navigation.
const HomePage = lazy(() => import("./pages/Home"));
import RegisterPage from "./pages/Register";
import OidcComplete from "./pages/Login/OidcComplete";
import SetupPage from "./pages/Setup";
import InvitePage from "./pages/Invite";
import AuthGuard from "./components/AuthGuard";
import OctopSpinner from "./components/OctopSpinner";
import { AntdAppProvider } from "./components/AntdAppProvider";
import GlobalErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AgentProvider } from "./context/AgentContext";
import { LayoutModeProvider } from "./context/LayoutModeContext";
import { VoiceOutputProvider } from "./context/VoiceOutputContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { useUnauthorizedRedirect } from "./hooks/useUnauthorizedRedirect";
import { installDesktopExternalLinks } from "./utils/desktopExternalLinks";
import { brandTokensFor } from "./styles/themePalettes";
import "./styles/theme-vars.css";
import "./styles/layout.css";
import "./styles/form-override.css";
import "./styles/spin-override.css";
// Single skin: manus-theme.css is the only global surface layer.
// The crayon/handwriting skin was retired — feature pages, the LYRA shell
// and the kid-facing planet app (8130) must not mix visual languages.
import "./styles/manus-theme.css";

const GlobalStyle = createGlobalStyle`
* {
  margin: 0;
  box-sizing: border-box;
}
`;

function ThemedApp() {
  const { isDark, palette, customColor } = useTheme();
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const desktopChrome = useDesktopChrome();
  const brandTokens = brandTokensFor(palette, isDark, customColor);
  // Make antd built-ins (Popconfirm OK/Cancel, Modal default footer, Empty,
  // Pagination, DatePicker, Table… ) follow the current UI language.
  // DatePicker month/weekday labels come from dayjs — keep it in sync too.
  const isZh = i18n.language?.toLowerCase().startsWith("zh") ?? false;
  const antdLocale = isZh ? zhCN : enUS;
  dayjs.locale(isZh ? "zh-cn" : "en");

  useUnauthorizedRedirect();

  useEffect(() => installDesktopExternalLinks(), []);

  // Set document title based on current language
  useEffect(() => {
    document.title = t("app.pageTitle");
  }, [t]);

  const themeConfig = {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      borderRadius: 10,
      ...(isMobile
        ? {
            fontSize: 15,
            fontSizeSM: 13,
            fontSizeLG: 17,
            fontSizeXL: 22,
            controlHeight: 36,
          }
        : {}),
      ...(isDark
        ? {
            colorBgBase: "#0f0f0f",
            colorTextBase: "#ededed",
            colorBgContainer: "#1a1a1a",
            colorBgElevated: "#222222",
            colorBgLayout: "#0f0f0f",
            colorBgSpotlight: "#2a2a2a",
            colorBgMask: "rgba(0, 0, 0, 0.72)",
            colorBorder: "#262626",
            colorBorderSecondary: "#202020",
            colorText: "rgba(237, 237, 237, 0.94)",
            colorTextSecondary: "rgba(237, 237, 237, 0.66)",
            colorTextTertiary: "rgba(237, 237, 237, 0.42)",
            colorTextQuaternary: "rgba(237, 237, 237, 0.26)",
            colorFill: "rgba(255, 255, 255, 0.08)",
            colorFillSecondary: "rgba(255, 255, 255, 0.05)",
            colorFillTertiary: "rgba(255, 255, 255, 0.04)",
            colorFillQuaternary: "rgba(255, 255, 255, 0.02)",
            colorBgTextHover: "rgba(255, 255, 255, 0.07)",
            ...brandTokens,
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
            boxShadowSecondary: "0 8px 28px rgba(0, 0, 0, 0.5)",
          }
        : {
            ...brandTokens,
            colorBgBase: "#ffffff",
            colorTextBase: "#1a1a1a",
            colorBgContainer: "#ffffff",
            colorBgElevated: "#ffffff",
            colorBgLayout: "#f7f7f7",
            colorBgSpotlight: "#1a1a1a",
            colorBgMask: "rgba(0, 0, 0, 0.45)",
            colorBorder: "#ebebeb",
            colorBorderSecondary: "#f0f0f0",
            colorFill: "rgba(0, 0, 0, 0.035)",
            colorFillSecondary: "rgba(0, 0, 0, 0.025)",
            colorFillTertiary: "rgba(0, 0, 0, 0.02)",
            colorFillQuaternary: "rgba(0, 0, 0, 0.012)",
            colorBgTextHover: "rgba(0, 0, 0, 0.04)",
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
            boxShadowSecondary: "0 8px 28px rgba(0, 0, 0, 0.1)",
          }),
    },
    components: isDark
      ? {
          Modal: { headerBg: "#1a1a1a", contentBg: "#1a1a1a" },
          Input: { colorBgBase: "#1a1a1a" },
          InputNumber: { colorBgBase: "#1a1a1a" },
          Select: { colorBgBase: "#1a1a1a", selectorBg: "#1a1a1a" },
          DatePicker: { colorBgBase: "#1a1a1a" },
          Segmented: { itemSelectedBg: "#2a2a2a" },
          Card: { colorBgContainer: "#1a1a1a" },
          Tooltip: { colorBgSpotlight: "#2a2a2a" },
        }
      : {},
  };

  return (
    <ConfigProvider
      theme={themeConfig}
      prefixCls="octop"
      locale={antdLocale}
      spin={{ indicator: <OctopSpinner /> }}
    >
      <AntdAppProvider>
        <DesktopChromeProvider value={desktopChrome}>
          {desktopChrome ? (
            <DesktopWindowControls chrome={desktopChrome} />
          ) : null}
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login/oidc/complete" element={<OidcComplete />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/invite" element={<InvitePage />} />
            <Route
              path="/*"
              element={
                <AuthGuard>
                  <AgentProvider>
                    <LayoutModeProvider>
                      <VoiceOutputProvider>
                        <Suspense fallback={<OctopSpinner />}>
                          <HomePage />
                        </Suspense>
                      </VoiceOutputProvider>
                    </LayoutModeProvider>
                  </AgentProvider>
                </AuthGuard>
              }
            />
          </Routes>
        </DesktopChromeProvider>
      </AntdAppProvider>
    </ConfigProvider>
  );
}

function App() {
  return (
    // `useTransitions` off: with router transitions on, React keeps the old
    // page mounted while a lazy route chunk downloads and never renders the
    // Suspense fallback, so a nav click looks like it did nothing.
    <BrowserRouter useTransitions={false}>
      <GlobalErrorBoundary>
        <GlobalStyle />
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </GlobalErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
