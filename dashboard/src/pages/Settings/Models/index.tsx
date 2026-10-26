/**
 * Models — admin-only provider management page.
 *
 * Admins can create, edit, enable/disable, test, and delete providers.
 * All providers are globally available to every agent.
 *
 * Layout:
 *  1. Preset providers (from /providers/presets) — shows configured ones via
 *     ProviderCard, unconfigured ones as "click to set up" cards.
 *  2. Custom providers — any configured provider whose name doesn't match a preset.
 */
import { useMemo, useState } from "react";
import { Button, Divider, Empty, Input, Space, Tabs, Typography } from "antd";
import {
  Images,
  MessageSquareText,
  Mic2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import PageShell from "../../../layouts/PageShell";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { userCan } from "../../../utils/permissions";
import { useProviders, type ProviderRow } from "./useProviders";
import {
  groupPresets,
  isLocalPreset,
  isPresetProvider,
  partitionCloudPresets,
  presetVariantLabel,
} from "./presetUtils";
import type { PresetGroup } from "./presetUtils";
import type { ProviderPreset } from "./useProviders";
import {
  CustomProviderModal,
  ActiveModelPool,
  LoadingState,
  PresetGroupCard,
  PresetProviderCard,
  ProviderCard,
} from "./components";
import styles from "./index.module.less";
import { MediaGenerationSettingsPanel } from "../MediaGeneration";
import { VoiceSettingsPanel } from "../Voice";
import { SearchSettingsPanel } from "../SearchConfig";

type ModelCategory = "chat" | "generation" | "voice" | "search";

function resolveModelCategory(
  requestedTab: string | null,
  canChat: boolean,
  canProviders: boolean,
  canVoice: boolean,
  canSearch: boolean,
): ModelCategory {
  if (requestedTab === "generation" && canProviders) return "generation";
  if (requestedTab === "voice" && canVoice) return "voice";
  if (requestedTab === "search" && canSearch) return "search";
  if ((requestedTab === "chat" || requestedTab === null) && canChat) {
    return "chat";
  }
  if (canChat) return "chat";
  if (canVoice) return "voice";
  if (canSearch) return "search";
  if (canProviders) return "generation";
  return "chat";
}

const { Title } = Typography;

function filterPresetCollection(
  collection: { grouped: PresetGroup[]; ungrouped: ProviderPreset[] },
  query: string,
): { grouped: PresetGroup[]; ungrouped: ProviderPreset[] } {
  if (!query) return collection;
  const matches = (values: Array<string | undefined>) =>
    values.some((value) => value?.toLowerCase().includes(query));
  return {
    grouped: collection.grouped.flatMap((group) => {
      if (matches([group.groupKey, group.groupName])) return [group];
      const presets = group.presets.filter((preset) =>
        matches([
          preset.id,
          preset.name,
          preset.vendor,
          preset.vendor_name,
          preset.provider_variant,
          presetVariantLabel(preset),
        ]),
      );
      return presets.length > 0 ? [{ ...group, presets }] : [];
    }),
    ungrouped: collection.ungrouped.filter((preset) =>
      matches([
        preset.id,
        preset.name,
        preset.vendor,
        preset.vendor_name,
        preset.provider_variant,
        presetVariantLabel(preset),
      ]),
    ),
  };
}

export default function ModelsPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const canProviders = userCan(user, "providers");
  const canOllama = userCan(user, "ollama_models");
  const canOnnx = userCan(user, "onnx_models");
  const canVoice = userCan(user, "voice");
  const canSearch = userCan(user, "search");
  const canChat = canProviders || canOllama || canOnnx;
  const {
    providers,
    presets,
    resolvedModels,
    activeModel,
    modelReasoning,
    loading,
    error,
    fetchAll,
  } = useProviders();
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [showMoreProviders, setShowMoreProviders] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const modelCategory = resolveModelCategory(
    searchParams.get("tab"),
    canChat,
    canProviders,
    canVoice,
    canSearch,
  );
  const setModelCategory = (next: string) => {
    const updated = new URLSearchParams(searchParams);
    if (next === "generation" || next === "voice" || next === "search") {
      updated.set("tab", next);
    } else updated.delete("tab");
    setSearchParams(updated, { replace: true });
  };

  const {
    featured: cloudFeatured,
    more: cloudMore,
    moreCount: moreProvidersCount,
  } = useMemo(
    () =>
      partitionCloudPresets(
        presets.filter((p) => !isLocalPreset(p)),
        providers,
      ),
    [presets, providers],
  );
  const localPresets = useMemo(
    () =>
      groupPresets(
        presets.filter((p) => {
          if (!isLocalPreset(p)) return false;
          if (p.id === "onnx") return canOnnx;
          if (p.id === "ollama") return canOllama;
          return canOllama || canOnnx;
        }),
      ),
    [presets, canOllama, canOnnx],
  );
  const showCloudTab = canProviders;
  const showLocalTab =
    (canOllama || canOnnx) &&
    (localPresets.grouped.length > 0 || localPresets.ungrouped.length > 0);
  const showPresetSection = showCloudTab || showLocalTab;
  const presetSearchQuery = presetSearch.trim().toLowerCase();
  const cloudSearchResults = useMemo(
    () =>
      presetSearchQuery
        ? filterPresetCollection(
            groupPresets(presets.filter((preset) => !isLocalPreset(preset))),
            presetSearchQuery,
          )
        : null,
    [presets, presetSearchQuery],
  );
  const localSearchResults = useMemo(
    () => filterPresetCollection(localPresets, presetSearchQuery),
    [localPresets, presetSearchQuery],
  );

  const renderPresetCards = (
    grouped: PresetGroup[],
    singles: ProviderPreset[],
  ) => (
    <>
      {grouped.map((group) => (
        <PresetGroupCard
          key={group.groupKey}
          group={group}
          providers={providers}
          onSaved={fetchAll}
          isHover={hoveredCard === `group-${group.groupKey}`}
          onMouseEnter={() => setHoveredCard(`group-${group.groupKey}`)}
          onMouseLeave={() => setHoveredCard(null)}
        />
      ))}
      {singles.map((preset) => (
        <PresetProviderCard
          key={preset.id}
          preset={preset}
          providers={providers}
          onSaved={fetchAll}
          isHover={hoveredCard === `preset-${preset.id}`}
          onMouseEnter={() => setHoveredCard(`preset-${preset.id}`)}
          onMouseLeave={() => setHoveredCard(null)}
        />
      ))}
    </>
  );

  const renderPresetGrid = (
    grouped: PresetGroup[],
    singles: ProviderPreset[],
  ) => {
    if (grouped.length === 0 && singles.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            presetSearchQuery
              ? t("models.noMatchingProviders")
              : t("models.noPresetProvidersInTab")
          }
        />
      );
    }
    return (
      <div className={styles.providerCards}>
        {renderPresetCards(grouped, singles)}
      </div>
    );
  };

  const renderCloudPresetGrid = () => {
    if (cloudSearchResults) {
      return renderPresetGrid(
        cloudSearchResults.grouped,
        cloudSearchResults.ungrouped,
      );
    }
    const hasFeatured =
      cloudFeatured.grouped.length > 0 || cloudFeatured.ungrouped.length > 0;
    const hasMore = moreProvidersCount > 0;
    if (!hasFeatured && !hasMore) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("models.noPresetProvidersInTab")}
        />
      );
    }
    return (
      <>
        {(hasFeatured || showMoreProviders) && (
          <div className={styles.providerCards}>
            {renderPresetCards(cloudFeatured.grouped, cloudFeatured.ungrouped)}
            {showMoreProviders &&
              renderPresetCards(cloudMore.grouped, cloudMore.ungrouped)}
          </div>
        )}
        {hasMore && (
          <Button
            type="link"
            size="small"
            className={styles.showMoreProvidersBtn}
            onClick={() => setShowMoreProviders((v) => !v)}
          >
            {showMoreProviders
              ? t("models.hideMoreProviders")
              : t("models.showMoreProviders", { count: moreProvidersCount })}
          </Button>
        )}
      </>
    );
  };

  // Custom providers: configured rows not already shown under a preset card
  const customProviders = useMemo<ProviderRow[]>(() => {
    return providers
      .filter((p) => !isPresetProvider(p, presets))
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.id - b.id;
      });
  }, [providers, presets]);

  const hasContent = presets.length > 0 || providers.length > 0;

  return (
    <PageShell
      title={t("pageShell.models.title")}
      subtitle={t("pageShell.models.subtitle")}
      actions={
        modelCategory === "chat" ? (
          <Space>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => void fetchAll()}
            >
              {t("common.refresh")}
            </Button>
          </Space>
        ) : null
      }
    >
      <Tabs
        activeKey={modelCategory}
        onChange={setModelCategory}
        items={[
          ...(canChat
            ? [
                {
                  key: "chat",
                  label: (
                    <Space className={styles.modelTabLabel} size={6}>
                      <MessageSquareText size={15} />
                      {t("models.chatModelsTab")}
                    </Space>
                  ),
                },
              ]
            : []),
          ...(canProviders
            ? [
                {
                  key: "generation",
                  label: (
                    <Space className={styles.modelTabLabel} size={6}>
                      <Images size={15} />
                      {t("models.generationModelsTab")}
                    </Space>
                  ),
                },
              ]
            : []),
          ...(canVoice
            ? [
                {
                  key: "voice",
                  label: (
                    <Space className={styles.modelTabLabel} size={6}>
                      <Mic2 size={15} />
                      {t("models.voiceModelsTab")}
                    </Space>
                  ),
                },
              ]
            : []),
          ...(canSearch
            ? [
                {
                  key: "search",
                  label: (
                    <Space className={styles.modelTabLabel} size={6}>
                      <Search size={15} />
                      {t("models.searchModelsTab")}
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {modelCategory === "generation" ? (
        <MediaGenerationSettingsPanel />
      ) : modelCategory === "voice" ? (
        <VoiceSettingsPanel />
      ) : modelCategory === "search" ? (
        <SearchSettingsPanel />
      ) : loading ? (
        <LoadingState message={t("models.loadingProviders")} />
      ) : error ? (
        <LoadingState message={error} error onRetry={() => void fetchAll()} />
      ) : !hasContent ? (
        <Empty description={t("models.noProvidersHint")} />
      ) : (
        <>
          <ActiveModelPool
            resolvedModels={resolvedModels}
            activeModel={activeModel}
            modelReasoning={modelReasoning}
            providers={providers}
            onSaved={fetchAll}
          />

          <Divider style={{ margin: "24px 0" }} />

          {showPresetSection && (
            <>
              <div className={styles.presetSectionHeader}>
                <Title level={5} style={{ margin: 0 }}>
                  {t("models.presetProviders")}
                </Title>
                <Input
                  allowClear
                  prefix={<Search size={14} />}
                  className={styles.presetSearch}
                  placeholder={t("models.searchPresetProviders")}
                  value={presetSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPresetSearch(value);
                    if (!value.trim()) setShowMoreProviders(false);
                  }}
                />
              </div>
              <Tabs
                items={[
                  showCloudTab
                    ? {
                        key: "cloud",
                        label: t("models.presetCloud"),
                        children: renderCloudPresetGrid(),
                      }
                    : null,
                  showLocalTab
                    ? {
                        key: "local",
                        label: t("models.presetLocal"),
                        children: renderPresetGrid(
                          localSearchResults.grouped,
                          localSearchResults.ungrouped,
                        ),
                      }
                    : null,
                ].filter((item) => item !== null)}
              />
            </>
          )}

          {canProviders && (
            <>
              {(presets.length > 0 || customProviders.length > 0) && (
                <Divider style={{ margin: "20px 0" }} />
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <Title level={5} style={{ margin: 0 }}>
                  {t("models.customProviders")}
                </Title>
                <Button
                  type="primary"
                  size="small"
                  icon={<Plus size={13} />}
                  onClick={() => setAddOpen(true)}
                >
                  {t("models.addCustomProvider")}
                </Button>
              </div>
              {customProviders.length > 0 ? (
                <div className={styles.providerCards}>
                  {customProviders.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      onSaved={fetchAll}
                      isHover={hoveredCard === String(p.id)}
                      onMouseEnter={() => setHoveredCard(String(p.id))}
                      onMouseLeave={() => setHoveredCard(null)}
                      apiPrefix="/admin/providers"
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("models.noCustomProvidersHint")}
                />
              )}
            </>
          )}
        </>
      )}

      {modelCategory === "chat" && (
        <CustomProviderModal
          open={addOpen && canProviders}
          onClose={() => setAddOpen(false)}
          onSaved={fetchAll}
          apiPrefix="/admin/providers"
        />
      )}
    </PageShell>
  );
}
