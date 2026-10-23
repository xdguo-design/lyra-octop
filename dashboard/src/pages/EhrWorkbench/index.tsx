import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Layout, Space, Tooltip, Typography } from "antd";
import {
  ApiOutlined,
  BugOutlined,
  ExperimentOutlined,
  MedicineBoxOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { ehrApi } from "@/api/modules/ehr";
import AgentPanel from "./AgentPanel";
import DrugQueryView from "./DrugQueryView";
import GraphView from "./GraphView";
import SearchHome from "./SearchHome";
import SkillsView from "./SkillsView";
import { EHR_NAV, type EhrViewKey } from "./types";
import styles from "./index.module.less";

const { Sider, Content } = Layout;

const VIEW_ICONS: Record<EhrViewKey, React.ReactNode> = {
  search: <SearchOutlined />,
  graph: <ApiOutlined />,
  drug: <MedicineBoxOutlined />,
  skills: <BugOutlined />,
};

export default function EhrWorkbenchPage() {
  const [view, setView] = useState<EhrViewKey>("search");
  const [agentOpen, setAgentOpen] = useState(true);
  const [ragUrl, setRagUrl] = useState("");
  const [ragDraft, setRagDraft] = useState("");
  const [urlEditing, setUrlEditing] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; docs: number } | null>(
    null,
  );
  const [healthError, setHealthError] = useState("");

  const refreshHealth = useCallback(async () => {
    try {
      const resp = await ehrApi.health();
      setHealth({ ok: resp.ok, docs: resp.docs });
      setHealthError("");
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setRagUrl(ehrApiResolveUrl());
    void refreshHealth();
  }, [refreshHealth]);

  // 直接内联避免循环依赖的小工具
  function ehrApiResolveUrl(): string {
    const stored = window.localStorage.getItem("ehr-rag-base-url");
    if (stored) return stored;
    const fromEnv = import.meta.env.VITE_EHR_RAG_URL as string | undefined;
    if (fromEnv) return fromEnv;
    return `http://${window.location.hostname || "127.0.0.1"}:8600`;
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

  const askAgent = useCallback((question: string) => {
    setAgentOpen(true);
    // 通过自定义事件通知 AgentPanel 发起提问
    window.dispatchEvent(
      new CustomEvent("ehr:ask-agent", { detail: question }),
    );
  }, []);

  return (
    <Layout className={styles.ehrWorkbench}>
      <Sider width={168} className={styles.ehrSider} theme="light">
        <div className={styles.ehrBrand}>
          <ExperimentOutlined style={{ fontSize: 20, color: "#1677ff" }} />
          <Typography.Text strong style={{ marginLeft: 8 }}>
            EHR 工作台
          </Typography.Text>
        </div>
        <nav className={styles.ehrNav} aria-label="EHR 导航">
          {EHR_NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={
                view === item.key ? styles.ehrNavItemActive : styles.ehrNavItem
              }
              onClick={() => setView(item.key)}
            >
              {VIEW_ICONS[item.key]}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={styles.ehrSiderFooter}>
          <Badge
            status={health?.ok ? "success" : "error"}
            text={
              health
                ? `已索引 ${health.docs} 条`
                : healthError
                ? "服务不可达"
                : "连接中…"
            }
          />
        </div>
      </Sider>

      <Content className={styles.ehrContent}>
        <div className={styles.ehrTopbar}>
          <Space wrap>
            <Typography.Text strong>
              {EHR_NAV.find((n) => n.key === view)?.label}
            </Typography.Text>
            <Tooltip title={ragUrl}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                服务：{ragUrl}
              </Typography.Text>
            </Tooltip>
            <Button
              size="small"
              type="link"
              onClick={() => {
                setRagDraft(ragUrl);
                setUrlEditing(true);
              }}
            >
              修改
            </Button>
            <Button size="small" type="link" onClick={refreshHealth}>
              刷新状态
            </Button>
          </Space>
          <Space>
            <Button size="small" onClick={() => setAgentOpen((v) => !v)}>
              {agentOpen ? "收起助手" : "展开助手"}
            </Button>
          </Space>
        </div>

        {healthError && (
          <Typography.Text
            type="danger"
            style={{ padding: "8px 16px", display: "block" }}
          >
            无法连接 EHR RAG 服务（{ragUrl}）：{healthError}
          </Typography.Text>
        )}

        <div className={styles.ehrBody}>
          <div className={styles.ehrMain}>
            {view === "search" && <SearchHome onAskAgent={askAgent} />}
            {view === "graph" && <GraphView onAskAgent={askAgent} />}
            {view === "drug" && <DrugQueryView />}
            {view === "skills" && <SkillsView />}
          </div>
          {agentOpen && (
            <div className={styles.ehrAgent}>
              <AgentPanel />
            </div>
          )}
        </div>
      </Content>

      {urlEditing && (
        <div className={styles.ehrUrlModal}>
          <Typography.Text strong>EHR RAG 服务地址</Typography.Text>
          <Input
            value={ragDraft}
            onChange={(e) => setRagDraft(e.target.value)}
            placeholder="http://119.3.216.103:8600"
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
