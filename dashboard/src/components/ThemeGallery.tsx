import { ColorPicker } from "antd";
import type { AggregationColor } from "antd/es/color-picker/color";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemePreference } from "../context/ThemeContext";
import {
  DEFAULT_PALETTE,
  PALETTE_SWATCH,
  VALID_PALETTES,
  type ThemePalette,
} from "../styles/themePalettes";
import styles from "./ThemeGallery.module.less";

const modes = [
  { key: "light", Icon: Sun, labelKey: "header.themeLight" },
  { key: "dark", Icon: Moon, labelKey: "header.themeDark" },
  { key: "system", Icon: Monitor, labelKey: "header.themeSystem" },
] as const;

function ThemePreview({ color, dark }: { color: string; dark: boolean }) {
  return (
    <span className={`${styles.preview} ${dark ? styles.previewDark : ""}`} aria-hidden="true">
      <span className={styles.previewRail}>
        <span className={styles.previewRailLogo} style={{ background: color }} />
        <span className={styles.previewRailLine} />
        <span className={styles.previewRailLineShort} />
      </span>
      <span className={styles.previewContent}>
        <span className={styles.previewHeading} />
        <span className={styles.previewText} />
        <span className={styles.previewTextShort} />
        <span className={styles.previewAction} style={{ background: color }} />
      </span>
    </span>
  );
}

/**
 * Personal appearance presets: palette and light/dark are separate axes.
 * Every card uses the same ThemeContext as the rest of the application:
 * switching is immediate and persists through appearanceStorage on reload.
 */
export default function ThemeGallery() {
  const { t } = useTranslation();
  const {
    preference,
    setPreference,
    palette,
    setPalette,
    customColor,
    setCustomColor,
    isDark,
  } = useTheme();

  const selectPalette = (value: ThemePalette) => setPalette(value);

  return (
    <div className={styles.root}>
      <div className={styles.modeHeading}>
        <span>{t("account.themeMode", "显示模式")}</span>
        <span className={styles.modeHint}>{t("account.themeModeHint", "可独立于主题配色切换")}</span>
      </div>
      <div
        className={styles.modeOptions}
        role="group"
        aria-label={t("account.themeMode", "显示模式")}
      >
        {modes.map(({ key, Icon, labelKey }) => (
          <button
            key={key}
            type="button"
            className={`${styles.modeOption} ${preference === key ? styles.modeSelected : ""}`}
            aria-pressed={preference === key}
            onClick={() => setPreference(key as ThemePreference)}
          >
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <div className={styles.galleryHeading}>
        <strong>{t("account.allThemes", "全部主题")}</strong>
        <span>{t("account.themeApplyHint", "点击立即应用，刷新后保留")}</span>
      </div>
      <div className={styles.grid} role="group" aria-label={t("account.allThemes", "全部主题")}>
        {VALID_PALETTES.map((key) => {
          const selected = palette === key;
          const label = t(`header.palette.${key}`);
          return (
            <button
              key={key}
              type="button"
              className={`${styles.card} ${selected ? styles.selected : ""}`}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => selectPalette(key)}
            >
              <ThemePreview color={PALETTE_SWATCH[key]} dark={isDark} />
              <span className={styles.cardFooter}>
                <span className={styles.cardName}>{label}</span>
                {selected ? (
                  <span className={styles.selectedMark} aria-label={t("account.themeSelected", "当前主题")}>
                    <Check size={13} strokeWidth={2.5} />
                    <span>{t("account.themeSelected", "使用中")}</span>
                  </span>
                ) : (
                  <span className={styles.colorDot} style={{ background: PALETTE_SWATCH[key] }} aria-hidden="true" />
                )}
              </span>
            </button>
          );
        })}
        <ColorPicker
          value={customColor}
          disabledAlpha
          onChangeComplete={(color: AggregationColor) => {
            setCustomColor(color.toHexString());
          }}
        >
          <button
            type="button"
            className={`${styles.card} ${styles.customCard} ${palette === "custom" ? styles.selected : ""}`}
            aria-label={t("header.palette.custom")}
            aria-pressed={palette === "custom"}
          >
            <span className={styles.customPreview} aria-hidden="true">
              <span className={styles.customPaletteIcon}><Palette size={24} /></span>
              <span className={styles.customHint}>{t("account.themeChooseColor", "选择自己的颜色")}</span>
            </span>
            <span className={styles.cardFooter}>
              <span className={styles.cardName}>{t("header.palette.custom")}</span>
              {palette === "custom" ? (
                <span className={styles.selectedMark}><Check size={13} />{t("account.themeSelected", "使用中")}</span>
              ) : (
                <span className={styles.colorDot} style={{ background: customColor }} aria-hidden="true" />
              )}
            </span>
          </button>
        </ColorPicker>
      </div>
      <button
        type="button"
        className={styles.resetButton}
        onClick={() => {
          setPalette(DEFAULT_PALETTE);
          setPreference("system");
        }}
      >
        {t("account.themeReset", "恢复默认主题")}
      </button>
    </div>
  );
}
