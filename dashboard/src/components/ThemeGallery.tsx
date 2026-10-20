import { ColorPicker } from "antd";
import type { AggregationColor } from "antd/es/color-picker/color";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemePreference } from "../context/ThemeContext";
import {
  DEFAULT_PALETTE,
  PALETTE_SWATCH,
  VALID_PALETTES,
} from "../styles/themePalettes";
import { DEFAULT_SKIN, VISUAL_SKINS } from "../styles/visualSkins";
import styles from "./ThemeGallery.module.less";

const modes = [
  { key: "light", Icon: Sun, labelKey: "header.themeLight" },
  { key: "dark", Icon: Moon, labelKey: "header.themeDark" },
  { key: "system", Icon: Monitor, labelKey: "header.themeSystem" },
] as const;

/** Miniature scene uses the exact surface/rail colors behind each real skin. */
export default function ThemeGallery() {
  const { t } = useTranslation();
  const {
    preference,
    setPreference,
    palette,
    setPalette,
    customColor,
    setCustomColor,
    skin,
    setSkin,
    isDark,
  } = useTheme();

  return (
    <div className={styles.root}>
      <div className={styles.sectionHeading}>
        <strong>{t("account.themeMode", "显示模式")}</strong>
        <span>{t("account.themeModeHint", "与风格主题独立切换")}</span>
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
            className={`${styles.modeOption} ${
              preference === key ? styles.modeSelected : ""
            }`}
            aria-pressed={preference === key}
            onClick={() => setPreference(key as ThemePreference)}
          >
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <div className={styles.sectionHeading}>
        <strong>{t("account.allThemes", "全部主题")}</strong>
        <span>{t("account.themeApplyHint", "点击切换整套界面风格")}</span>
      </div>
      <div
        className={styles.skinGrid}
        role="group"
        aria-label={t("account.allThemes", "全部主题")}
      >
        {VISUAL_SKINS.map((definition) => {
          const selected = definition.id === skin;
          const colors = isDark ? definition.dark : definition.light;
          const name = t(`account.skin.${definition.id}`);
          return (
            <button
              key={definition.id}
              type="button"
              className={`${styles.skinCard} ${
                selected ? styles.selected : ""
              }`}
              aria-label={name}
              aria-pressed={selected}
              onClick={() => setSkin(definition.id)}
            >
              <span
                className={styles.skinPreview}
                style={{
                  backgroundColor: colors.canvas,
                  color: colors.text,
                  backgroundImage: `linear-gradient(rgba(255,255,255,.2), rgba(255,255,255,.2)), url("${definition.image}")`,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
                aria-hidden="true"
              >
                <span
                  className={styles.skinRail}
                  style={{ backgroundColor: colors.sidebar }}
                >
                  <span
                    className={styles.skinLogo}
                    style={{ backgroundColor: colors.accent }}
                  />
                  <span
                    className={styles.skinRailLine}
                    style={{ backgroundColor: colors.muted }}
                  />
                  <span
                    className={styles.skinRailLineShort}
                    style={{ backgroundColor: colors.muted }}
                  />
                </span>
                <span className={styles.skinWork}>
                  <span
                    className={styles.skinHeaderLine}
                    style={{ backgroundColor: colors.text }}
                  />
                  <span
                    className={styles.skinMiniCard}
                    style={{
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: definition.radius / 2,
                    }}
                  >
                    <span
                      className={styles.skinTextLine}
                      style={{ backgroundColor: colors.muted }}
                    />
                    <span
                      className={styles.skinTextLineShort}
                      style={{ backgroundColor: colors.muted }}
                    />
                    <span
                      className={styles.skinAction}
                      style={{ backgroundColor: colors.accent }}
                    />
                  </span>
                </span>
              </span>
              <span className={styles.skinFooter}>
                <span className={styles.skinName}>{name}</span>
                {selected ? (
                  <Check
                    size={15}
                    aria-label={t("account.themeSelected", "使用中")}
                  />
                ) : null}
              </span>
              <span className={styles.skinDescription}>
                {t(`account.skinDesc.${definition.id}`)}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.sectionHeading}>
        <strong>{t("account.palette", "品牌配色")}</strong>
        <span>{t("account.paletteHint", "可与任意风格组合")}</span>
      </div>
      <div
        className={styles.paletteGrid}
        role="group"
        aria-label={t("account.palette", "品牌配色")}
      >
        {VALID_PALETTES.map((key) => {
          const selected = key === palette;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.paletteOption} ${
                selected ? styles.paletteSelected : ""
              }`}
              aria-label={t(`header.palette.${key}`)}
              aria-pressed={selected}
              onClick={() => setPalette(key)}
            >
              <span
                className={styles.paletteDot}
                style={{ backgroundColor: PALETTE_SWATCH[key] }}
                aria-hidden="true"
              />
              <span className={styles.paletteLabel}>
                {t(`header.palette.${key}`)}
              </span>
              {selected ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          );
        })}
        <ColorPicker
          value={customColor}
          disabledAlpha
          onChangeComplete={(color: AggregationColor) =>
            setCustomColor(color.toHexString())
          }
        >
          <button
            type="button"
            className={`${styles.paletteOption} ${
              palette === "custom" ? styles.paletteSelected : ""
            }`}
            aria-label={t("header.palette.custom")}
            aria-pressed={palette === "custom"}
          >
            <span
              className={styles.customPalette}
              style={
                palette === "custom" ? { background: customColor } : undefined
              }
            >
              <Palette size={14} aria-hidden="true" />
            </span>
            <span className={styles.paletteLabel}>
              {t("header.palette.custom")}
            </span>
            {palette === "custom" ? (
              <Check size={12} aria-hidden="true" />
            ) : null}
          </button>
        </ColorPicker>
      </div>

      <button
        type="button"
        className={styles.resetButton}
        onClick={() => {
          setSkin(DEFAULT_SKIN);
          setPalette(DEFAULT_PALETTE);
          setPreference("system");
        }}
      >
        {t("account.themeReset", "恢复默认主题")}
      </button>
    </div>
  );
}
