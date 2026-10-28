import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Layout, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { SettingOutlined } from "@ant-design/icons";
import { ehrApi, publicEhrApi } from "@/api/modules/ehr";
import AgentPanel from "./AgentPanel";
import DrugQueryView from "./DrugQueryView";
import GraphView from "./GraphView";
import SearchHome from "./SearchHome";
import SkillsView from "./SkillsView";
import { EHR_NAV, type EhrViewKey } from "./types";
import styles from "./index.module.less";

const { Content } = Layout;

export default function EhrWorkbenchPage({
  publicMode = false,
}: {
  publicMode?: boolean;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<EhrViewKey>("search");
  const [agentOpen, setAgentOpen] = useState(false);
  const [ragUrl, setRagUrl] = useState("");
  const [ragDraft, setRagDraft] = useState("");
  const [urlEditing, setUrlEditing] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; docs: number } | null>(
    null,
  );
  const [healthError, setHealthError] = useState("");

  const refreshHealth = useCallback(async () => {
    try {
      if (publicMode) {
        const resp = await publicEhrApi.health();
        setHealth({ ok: resp.ok, docs: 0 });
      } else {
        const resp = await ehrApi.health();
        setHealth({ ok: resp.ok, docs: resp.docs });
      }
      setHealthError("");
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : String(err));
    }
  }, [publicMode]);

  useEffect(() => {
    setRagUrl(publicMode ? "" : ehrApiResolveUrl());
    void refreshHealth();
  }, [publicMode, refreshHealth]);

  // 直接内联避免循环依赖的小工具
  function ehrApiResolveUrl(): string {
    const stored = window.localStorage.getItem("ehr-rag-base-url");
    if (stored) return stored;
    const fromEnv = import.meta.env.VITE_EHR_RAG_URL as string | undefined;
    if (fromEnv) return fromEnv;
    return "/ehr-rag";
  }

  const saveUrl = () => {
    const url = ragDraft.trim();
    if (url) {
      window.localStorage.setItem("ehr-rag-base-url", url.replace(/\/+$/, ""));
      setRagUrl(url.replace(/\/+$/, ""));
    }
    setUrlEditing(false);
    void refreshHealth();
  };

  return (
    <Layout className={styles.ehrWorkbench}>
      <Content className={styles.ehrContent}>
        <div className={styles.ehrTopbar}>
          <Space size={12}>
            {view !== "search" && (
              <>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setView("search")}
                >
                  ← {t("ehrWorkbenchPage.backToSearch")}
                </Button>
                <Typography.Text strong>
                  {EHR_NAV.find((item) => item.key === view)?.label}
                </Typography.Text>
              </>
            )}
            <Badge
              status={
                health?.ok ? "success" : healthError ? "error" : "processing"
              }
              text={
                health
                  ? publicMode
                    ? t("ehrWorkbenchPage.publicAvailable")
                    : t("ehrWorkbenchPage.indexedCount", { count: health.docs })
                  : healthError
                  ? t("ehrWorkbenchPage.serviceUnavailable")
                  : t("ehrWorkbenchPage.serviceConnecting")
              }
            />
          </Space>
          <Space size={4}>
            {publicMode && <Tag>{t("ehrWorkbenchPage.publicReadOnly")}</Tag>}
            <Button
              type="text"
              size="small"
              onClick={() => setAgentOpen((v) => !v)}
            >
              {agentOpen
                ? t("ehrWorkbenchPage.closeDelivery")
                : t("ehrWorkbenchPage.openDelivery")}
            </Button>
            {!publicMode && (
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined />}
                aria-label={t("ehrWorkbenchPage.retrievalSettings")}
                title={t("ehrWorkbenchPage.retrievalSettings")}
                onClick={() => {
                  setRagDraft(ragUrl);
                  setUrlEditing(true);
                }}
              />
            )}
          </Space>
        </div>

        {healthError && (
          <Typography.Text
            type="danger"
            style={{ padding: "8px 24px", display: "block" }}
          >
            {publicMode
              ? t("ehrWorkbenchPage.publicUnavailable")
              : `无法连接 EHR RAG 服务（${ragUrl}）：${healthError}`}
          </Typography.Text>
        )}

        <div className={styles.ehrBody}>
          <div className={styles.ehrMain}>
            {view === "search" && (
              <SearchHome
                publicMode={publicMode}
                onOpenDrugQuery={() => setView("drug")}
              />
            )}
            {view === "graph" && <GraphView />}
            {view === "drug" && <DrugQueryView />}
            {view === "skills" && <SkillsView />}
          </div>
          {agentOpen && (
            <div className={styles.ehrAgent}>
              <AgentPanel
                publicMode={publicMode}
                onClose={() => setAgentOpen(false)}
              />
            </div>
          )}
        </div>
      </Content>

      {!publicMode && urlEditing && (
        <div className={styles.ehrUrlModal}>
          <Typography.Text strong>EHR RAG 服务地址</Typography.Text>
          <Input
            value={ragDraft}
            onChange={(e) => setRagDraft(e.target.value)}
            placeholder="/ehr-rag"
            onPressEnter={saveUrl}
          />
          <Space>
            <Button type="primary" onClick={saveUrl}>
              保存
            </Button>
            <Button onClick={() => setUrlEditing(false)}>取消</Button>
          </Space>
        </div>
      )}
    </Layout>
  );
}
