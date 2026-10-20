import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  Select,
  Switch,
  Typography,
} from "antd";
import { message } from "@/utils/antdMessage";

import { Activity, Mic2, Check, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  voiceApi,
  type VoicePreset,
  type VoiceProviderInput,
  type VoiceProviderRow,
} from "../../../api/modules/voice";
import { customProviderLogo, getProviderLogo } from "../../../assets/providers";
import { invalidateVoiceConfigCache } from "../../../hooks/useVoiceConfig";
import { TabPanelHeader } from "../AdvancedSettings/TabPanelHeader";
import styles from "./index.module.less";

const { Text } = Typography;

const DOUBAO_DEFAULT_VOICE_ID = "zh_female_wenjingmaomao_uranus_bigtts";
const DOUBAO_CUSTOM_VOICE = "__custom_voice_id__";
const DOUBAO_TTS_VOICE_IDS = new Set([
  DOUBAO_DEFAULT_VOICE_ID,
  "zh_female_wenroumama_uranus_bigtts",
  "zh_female_wenroushunv_uranus_bigtts",
  "zh_female_qingchezizi_uranus_bigtts",
  "zh_male_wenrouxiaoge_uranus_bigtts",
  "zh_male_jieshuoxiaoming_uranus_bigtts",
]);

function voiceLogoForKind(kind: string): string {
  return getProviderLogo(kind) ?? customProviderLogo;
}

interface ConfigureState {
  preset: VoicePreset;
  existing?: VoiceProviderRow;
}

/** Voice provider settings panel — embeddable in the Models page tab. */
export function VoiceSettingsPanel() {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<VoicePreset[]>([]);
  const [providers, setProviders] = useState<VoiceProviderRow[]>([]);
  const [active, setActive] = useState({ stt: "browser", tts: "browser" });
  const [loading, setLoading] = useState(true);
  const [configure, setConfigure] = useState<ConfigureState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [realtimeStt, setRealtimeStt] = useState(false);
  const [appId, setAppId] = useState("");
  const [mimoEndpoint, setMimoEndpoint] = useState<"payg" | "tokenplan">(
    "payg",
  );
  const [mimoVoiceId, setMimoVoiceId] = useState("冰糖");
  const [doubaoVoiceId, setDoubaoVoiceId] = useState("");
  const [doubaoVoiceCustom, setDoubaoVoiceCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [presetList, rows, activeVoice] = await Promise.all([
        voiceApi.getPresets(),
        voiceApi.getProviders(),
        voiceApi.getActive(),
      ]);
      setPresets(presetList);
      setProviders(rows);
      setActive(activeVoice);
    } catch (err) {
      message.error(t("voice.loadError"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const sttPresets = useMemo(
    () =>
      presets.filter((p) => p.capability === "stt" || p.capability === "both"),
    [presets],
  );
  const ttsPresets = useMemo(
    () =>
      presets.filter((p) => p.capability === "tts" || p.capability === "both"),
    [presets],
  );

  const findConfigured = (preset: VoicePreset) =>
    providers.find((p) => p.name === preset.id || p.name === preset.name);

  const setActiveProvider = async (kind: "stt" | "tts", name: string) => {
    try {
      const next = await voiceApi.setActive(
        kind === "stt" ? { stt: name } : { tts: name },
      );
      setActive(next);
      invalidateVoiceConfigCache();
      message.success(t("voice.activeUpdated"));
    } catch {
      message.error(t("voice.activeUpdateFailed"));
    }
  };

  const openConfigure = (preset: VoicePreset) => {
    const existing = findConfigured(preset);
    setConfigure({ preset, existing });
    setApiKey("");
    const extra = existing?.extra ?? {};
    setSecretId(String(extra.secret_id ?? ""));
    setSecretKey(String(extra.secret_key ?? ""));
    setRealtimeStt(extra.realtime_stt === true);
    setAppId(String(extra.app_id ?? ""));
    setMimoEndpoint(extra.endpoint_type === "tokenplan" ? "tokenplan" : "payg");
    setMimoVoiceId(String(extra.voice_id ?? "冰糖"));
    const voiceId = String(extra.voice_id ?? "");
    setDoubaoVoiceId(voiceId || DOUBAO_DEFAULT_VOICE_ID);
    setDoubaoVoiceCustom(
      Boolean(voiceId && !DOUBAO_TTS_VOICE_IDS.has(voiceId)),
    );
  };

  const buildProviderPayload = (): VoiceProviderInput | null => {
    if (!configure) return null;
    const { preset } = configure;
    let extra: Record<string, unknown>;
    let baseUrl: string | null = null;
    if (preset.kind === "tencent") {
      extra = {
        secret_id: secretId,
        secret_key: secretKey,
        region: "ap-guangzhou",
        realtime_stt: realtimeStt,
        app_id: appId.trim() || undefined,
      };
    } else if (preset.kind === "edge") {
      extra = { voice_id: "zh-CN-XiaoxiaoNeural" };
    } else if (preset.kind === "mimo") {
      baseUrl =
        mimoEndpoint === "tokenplan"
          ? "https://token-plan-cn.xiaomimimo.com/v1"
          : "https://api.xiaomimimo.com/v1";
      extra = {
        endpoint_type: mimoEndpoint,
        voice_id: preset.capability === "tts" ? mimoVoiceId : undefined,
      };
    } else if (preset.kind === "doubao") {
      extra = {
        stt_resource_id: "volc.seedasr.sauc.duration",
        tts_resource_id: "seed-tts-2.0",
        voice_id: doubaoVoiceId.trim() || undefined,
      };
    } else {
      extra = { model: preset.kind === "openai" ? "whisper-1" : undefined };
    }
    return {
      name: preset.id,
      kind: preset.kind,
      capability: preset.capability,
      base_url: baseUrl,
      api_key:
        preset.kind === "tencent"
          ? secretId && secretKey
            ? `${secretId}:${secretKey}`
            : null
          : apiKey.trim() || undefined,
      extra_json: JSON.stringify(extra),
    };
  };

  const validateCredentials = () => {
    if (!configure?.preset.requires_key) return true;
    const complete =
      configure.preset.kind === "tencent"
        ? Boolean(secretId.trim() && secretKey.trim())
        : Boolean(apiKey.trim() || configure?.existing?.api_key_configured);
    if (!complete) message.warning(t("voice.credentialsRequired"));
    if (
      complete &&
      configure?.preset.kind === "doubao" &&
      doubaoVoiceCustom &&
      !doubaoVoiceId.trim()
    ) {
      message.warning(t("voice.doubaoCustomVoiceRequired"));
      return false;
    }
    if (complete && realtimeStt && !appId.trim()) {
      message.warning(t("voice.realtimeAppIdRequired"));
      return false;
    }
    return complete;
  };

  const handleProbe = async () => {
    const payload = buildProviderPayload();
    if (!payload || !validateCredentials() || !configure) return;
    const modes: ("stt" | "tts")[] =
      configure.preset.capability === "both"
        ? ["stt", "tts"]
        : [configure.preset.capability];
    setProbing(true);
    try {
      for (const mode of modes) {
        const result =
          configure.existing?.api_key_configured && !apiKey.trim()
            ? await voiceApi.testProvider(configure.existing.id, mode)
            : await voiceApi.testConfiguration({ ...payload, mode });
        if (!result.ok) {
          message.error(result.error || t("voice.probeFailed"));
          return;
        }
      }
      message.success(t("voice.probeSuccess"));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("voice.probeFailed"),
      );
    } finally {
      setProbing(false);
    }
  };

  const handleSaveProvider = async () => {
    const payload = buildProviderPayload();
    if (!configure || !payload || !validateCredentials()) return;
    setSaving(true);
    try {
      const { preset, existing } = configure;
      if (existing) {
        await voiceApi.patchProvider(existing.id, payload);
      } else {
        await voiceApi.createProvider(payload);
      }
      // The active payload carries `stt_realtime`, so drop the cache even when
      // the active provider itself does not change (e.g. the switch was toggled).
      invalidateVoiceConfigCache();
      if (
        preset.kind !== "browser" &&
        (preset.capability === "stt" || preset.capability === "both") &&
        active.stt === "browser"
      ) {
        const next = await voiceApi.setActive({ stt: preset.id });
        setActive(next);
      }
      if (
        preset.kind !== "browser" &&
        (preset.capability === "tts" || preset.capability === "both") &&
        active.tts === "browser"
      ) {
        const next = await voiceApi.setActive({ tts: preset.id });
        setActive(next);
      }
      message.success(t("voice.saved"));
      setConfigure(null);
      await fetchAll();
    } catch {
      message.error(t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const renderPresetCard = (preset: VoicePreset, kind: "stt" | "tts") => {
    const configured = findConfigured(preset);
    const isActive = active[kind] === preset.id;
    const needsSetup =
      preset.requires_key && !configured && preset.kind !== "browser";
    const logo = voiceLogoForKind(preset.kind);

    const cardClass = [
      styles.card,
      isActive ? styles.cardActive : "",
      needsSetup ? styles.cardSetup : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        key={`${kind}-${preset.id}`}
        className={cardClass}
        role={needsSetup ? "button" : undefined}
        tabIndex={needsSetup ? 0 : undefined}
        onClick={needsSetup ? () => openConfigure(preset) : undefined}
        onKeyDown={
          needsSetup
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openConfigure(preset);
                }
              }
            : undefined
        }
      >
        <div className={styles.cardHeader}>
          <div className={styles.logoTile}>
            <img
              src={logo}
              alt={preset.name}
              className={styles.logo}
              draggable={false}
            />
          </div>
          <div className={styles.titleBlock}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{preset.name}</span>
            </div>
            <div className={styles.kind}>{preset.kind}</div>
          </div>
          <div className={styles.badges}>
            {isActive && (
              <span className={`${styles.badge} ${styles.badgeActive}`}>
                <Check size={11} />
                {t("voice.active")}
              </span>
            )}
            {preset.free && (
              <span className={`${styles.badge} ${styles.badgeFree}`}>
                {t("voice.free")}
              </span>
            )}
            {preset.limited_free && (
              <span className={`${styles.badge} ${styles.badgeFree}`}>
                {t("voice.limitedFree")}
              </span>
            )}
            {needsSetup && (
              <span className={`${styles.badge} ${styles.badgeSetup}`}>
                {t("voice.notConfigured")}
              </span>
            )}
          </div>
        </div>

        <p className={styles.description}>{preset.description}</p>

        <div className={styles.actions}>
          {needsSetup ? (
            <Button
              size="small"
              type="primary"
              icon={<Settings2 size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                openConfigure(preset);
              }}
            >
              {t("voice.configure")}
            </Button>
          ) : (
            <>
              <Button
                size="small"
                type={isActive ? "default" : "primary"}
                disabled={isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  void setActiveProvider(kind, preset.id);
                }}
              >
                {isActive ? t("voice.current") : t("voice.setActive")}
              </Button>
              {preset.requires_key && configured ? (
                <Button
                  size="small"
                  icon={<Settings2 size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openConfigure(preset);
                  }}
                >
                  {t("common.edit")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <TabPanelHeader
        icon={<Mic2 size={22} />}
        title={t("models.voiceModelsTab")}
        description={t("voice.description")}
      />

      {loading ? (
        <Text type="secondary">{t("voice.loading")}</Text>
      ) : (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("voice.sttSection")}</h3>
            <div className={styles.grid}>
              {sttPresets.map((p) => renderPresetCard(p, "stt"))}
            </div>
          </section>

          <Divider className={styles.divider} />

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("voice.ttsSection")}</h3>
            <div className={styles.grid}>
              {ttsPresets.map((p) => renderPresetCard(p, "tts"))}
            </div>
          </section>
        </>
      )}

      <Drawer
        title={t("voice.configureTitle", {
          name: configure?.preset.name ?? "",
        })}
        open={!!configure}
        onClose={() => setConfigure(null)}
        width={440}
        placement="right"
        destroyOnHidden
        footer={
          <div className={styles.drawerFooter}>
            <Button onClick={() => setConfigure(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              icon={<Activity size={14} />}
              loading={probing}
              onClick={() => void handleProbe()}
            >
              {t("voice.probe")}
            </Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void handleSaveProvider()}
            >
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <Form layout="vertical">
          {configure?.preset.kind === "tencent" && (
            <>
              <div className={styles.drawerHint}>{t("voice.tencentHint")}</div>
              <Form.Item label="SecretId" required>
                <Input
                  placeholder="SecretId"
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                />
              </Form.Item>
              <Form.Item label="SecretKey" required>
                <Input.Password
                  placeholder="SecretKey"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                />
              </Form.Item>
              <Form.Item
                label={t("voice.realtimeStt")}
                style={{ marginBottom: 8 }}
              >
                <Switch checked={realtimeStt} onChange={setRealtimeStt} />
              </Form.Item>
              <Form.Item label="AppID" required={realtimeStt}>
                <Input
                  placeholder="1300000000"
                  value={appId}
                  disabled={!realtimeStt}
                  inputMode="numeric"
                  onChange={(e) => setAppId(e.target.value)}
                />
              </Form.Item>
              {realtimeStt && (
                <div className={styles.drawerHint}>
                  {t("voice.realtimeSttHint")}
                </div>
              )}
            </>
          )}
          {configure?.preset.kind === "openai" && (
            <>
              <div className={styles.drawerHint}>{t("voice.openaiHint")}</div>
              <Form.Item label="API Key" required>
                <Input.Password
                  placeholder="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Form.Item>
              <Form.Item label={t("voice.mimoEndpoint")}>
                <Select
                  value="https://api.openai.com/v1"
                  disabled
                  options={[
                    {
                      value: "https://api.openai.com/v1",
                      label: "OpenAI API",
                    },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {configure?.preset.kind === "mimo" && (
            <>
              <div className={styles.drawerHint}>{t("voice.mimoHint")}</div>
              <Form.Item label={t("voice.mimoEndpoint")} required>
                <Select
                  value={mimoEndpoint}
                  onChange={(v) => setMimoEndpoint(v)}
                  options={[
                    {
                      value: "payg",
                      label: t("voice.mimoEndpointPayg"),
                    },
                    {
                      value: "tokenplan",
                      label: t("voice.mimoEndpointTokenplan"),
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item label="API Key" required>
                <Input.Password
                  placeholder="API Key (sk-... / tp-...)"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Form.Item>
              {configure.preset.capability === "tts" && (
                <Form.Item label={t("voice.mimoVoice")}>
                  <Select
                    value={mimoVoiceId}
                    onChange={(v) => setMimoVoiceId(v)}
                    options={[
                      { value: "冰糖", label: "冰糖 (中文·女)" },
                      { value: "茉莉", label: "茉莉 (中文·女)" },
                      { value: "苏打", label: "苏打 (中文·男)" },
                      { value: "白桦", label: "白桦 (中文·男)" },
                      { value: "Mia", label: "Mia (EN·Female)" },
                      { value: "Chloe", label: "Chloe (EN·Female)" },
                      { value: "Milo", label: "Milo (EN·Male)" },
                      { value: "Dean", label: "Dean (EN·Male)" },
                    ]}
                  />
                </Form.Item>
              )}
            </>
          )}
          {configure?.preset.kind === "doubao" && (
            <>
              <div className={styles.drawerHint}>{t("voice.doubaoHint")}</div>
              <Form.Item
                label="API Key"
                required={!configure.existing?.api_key_configured}
              >
                <Input.Password
                  placeholder={
                    configure.existing?.api_key_configured
                      ? t("voice.keyConfiguredPlaceholder")
                      : "API Key"
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Form.Item>
              <Form.Item label={t("voice.doubaoVoice")}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={
                    doubaoVoiceCustom ? DOUBAO_CUSTOM_VOICE : doubaoVoiceId
                  }
                  options={[
                    {
                      label: t("voice.doubaoVoiceDefault"),
                      value: DOUBAO_DEFAULT_VOICE_ID,
                    },
                    {
                      label: t("voice.doubaoVoiceWenrouMama"),
                      value: "zh_female_wenroumama_uranus_bigtts",
                    },
                    {
                      label: t("voice.doubaoVoiceWenrouShunv"),
                      value: "zh_female_wenroushunv_uranus_bigtts",
                    },
                    {
                      label: t("voice.doubaoVoiceQingcheZizi"),
                      value: "zh_female_qingchezizi_uranus_bigtts",
                    },
                    {
                      label: t("voice.doubaoVoiceWenrouXiaoge"),
                      value: "zh_male_wenrouxiaoge_uranus_bigtts",
                    },
                    {
                      label: t("voice.doubaoVoiceJieshuoXiaoming"),
                      value: "zh_male_jieshuoxiaoming_uranus_bigtts",
                    },
                    {
                      label: t("voice.doubaoVoiceCustomOption"),
                      value: DOUBAO_CUSTOM_VOICE,
                    },
                  ]}
                  onChange={(value: string) => {
                    const isCustom = value === DOUBAO_CUSTOM_VOICE;
                    setDoubaoVoiceCustom(isCustom);
                    if (!isCustom) setDoubaoVoiceId(value);
                    else setDoubaoVoiceId("");
                  }}
                />
                {doubaoVoiceCustom && (
                  <Input
                    style={{ marginTop: 8 }}
                    placeholder={t("voice.doubaoCustomVoicePlaceholder")}
                    value={doubaoVoiceId}
                    onChange={(e) => setDoubaoVoiceId(e.target.value)}
                  />
                )}
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
    </>
  );
}

export default VoiceSettingsPanel;
