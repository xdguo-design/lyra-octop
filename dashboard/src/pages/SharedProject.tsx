import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Button, Card, Empty, Spin, Tag, Typography } from "antd";
import { Folder, MessageSquareText, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import {
  workbenchApi,
  type SharedProjectPayload,
  type SharedThreadHistory,
} from "../api/modules/workbench";
import { formatServerDateTime } from "../utils/formatMessageTime";
import "./shared-project.less";

export default function SharedProjectPage() {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState<SharedProjectPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<SharedThreadHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const referrerMeta = document.createElement("meta");
    referrerMeta.name = "referrer";
    referrerMeta.content = "no-referrer";
    document.head.appendChild(referrerMeta);
    setData(null);
    setLoadFailed(false);
    void workbenchApi
      .getSharedProject(token)
      .then(setData)
      .catch(() => setLoadFailed(true));
    return () => referrerMeta.remove();
  }, [token]);

  const projectById = useMemo(
    () =>
      new Map(data?.projects.map((project) => [project.project_id, project])),
    [data],
  );
  const folderById = useMemo(
    () => new Map(data?.folders.map((folder) => [folder.folder_id, folder])),
    [data],
  );
  const activeThread = data?.threads.find(
    (thread) => thread.thread_id === activeThreadId,
  );

  useEffect(() => {
    if (
      !activeThreadId ||
      !history ||
      !["pending", "queued", "running"].includes(history.history_status)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void workbenchApi
        .getSharedThreadHistory(token, activeThreadId, 100, 0)
        .then(setHistory)
        .catch(() =>
          setHistory({
            messages: [],
            has_more: false,
            next_offset: 0,
            history_status: "failed",
          }),
        );
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [activeThreadId, history, token]);

  const loadHistory = async (threadId: string, offset = 0) => {
    setHistoryLoading(true);
    try {
      const page = await workbenchApi.getSharedThreadHistory(
        token,
        threadId,
        100,
        offset,
      );
      setHistory((current) => ({
        ...page,
        messages:
          offset > 0
            ? [...page.messages, ...(current?.messages ?? [])]
            : page.messages,
      }));
    } catch {
      setHistory({
        messages: [],
        has_more: false,
        next_offset: offset,
        history_status: "unavailable",
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const renderProject = (projectId: string, depth = 0) => {
    const project = projectById.get(projectId);
    if (!project) return null;
    const children = data?.projects.filter(
      (candidate) => candidate.parent_id === projectId,
    );
    const folders = data?.folders.filter(
      (folder) => folder.project_id === projectId,
    );
    const threads = data?.threads.filter(
      (thread) => thread.project_id === projectId,
    );
    return (
      <div key={projectId} style={{ marginLeft: depth * 16 }}>
        <Typography.Title level={5}>
          <span aria-hidden="true">{project.icon}</span> {project.name}
        </Typography.Title>
        {folders?.map((folder) => (
          <Typography.Paragraph key={folder.folder_id} type="secondary">
            <Folder size={14} style={{ verticalAlign: "-2px" }} /> {folder.name}
          </Typography.Paragraph>
        ))}
        {threads?.map((thread) => (
          <Button
            key={thread.thread_id}
            type={activeThreadId === thread.thread_id ? "primary" : "text"}
            block
            style={{ justifyContent: "flex-start", textAlign: "left" }}
            icon={<MessageSquareText size={15} />}
            onClick={() => {
              setActiveThreadId(thread.thread_id);
              setHistory(null);
              void loadHistory(thread.thread_id);
            }}
          >
            {thread.title || t("workbench.home.projects.sharedProject.tasks")}
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {thread.folder_id
                ? folderById.get(thread.folder_id)?.name
                : t("workbench.home.projects.sharedProject.unfiled")}
            </Typography.Text>
          </Button>
        ))}
        {children?.map((child) => renderProject(child.project_id, depth + 1))}
      </div>
    );
  };

  if (loadFailed) {
    return (
      <main style={{ maxWidth: 640, margin: "10vh auto", padding: 24 }}>
        <Alert
          type="warning"
          showIcon
          message={t("workbench.home.projects.sharedProject.notAvailable")}
        />
      </main>
    );
  }
  if (!data) {
    return (
      <main
        style={{ display: "grid", minHeight: "60vh", placeItems: "center" }}
      >
        <Spin size="large" />
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1120, margin: "32px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 24 }}>
        <Typography.Title level={2}>
          {data.project.icon} {data.project.name}
        </Typography.Title>
        <Tag icon={<ShieldCheck size={13} />} color="blue">
          {t("workbench.home.projects.sharedProject.readOnly")}
        </Tag>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          {t("workbench.home.projects.sharedProject.expiresAt", {
            date: formatServerDateTime(data.expires_at, data.timezone),
          })}
        </Typography.Paragraph>
      </header>
      <div className="shared-project-layout">
        <Card title={t("workbench.home.projects.sharedProject.title")}>
          {data.threads.length ? (
            renderProject(data.project.project_id)
          ) : (
            <Empty
              description={t(
                "workbench.home.projects.sharedProject.emptyTasks",
              )}
            />
          )}
        </Card>
        <Card
          title={
            activeThread?.title ||
            t("workbench.home.projects.sharedProject.selectTask")
          }
          style={{ minHeight: 420 }}
        >
          {!activeThread ? (
            <Empty
              description={t(
                "workbench.home.projects.sharedProject.selectTask",
              )}
            />
          ) : historyLoading && !history ? (
            <Spin />
          ) : history &&
            ["pending", "queued", "running"].includes(
              history.history_status,
            ) ? (
            <Spin />
          ) : history?.history_status !== "ready" ? (
            <Empty
              description={t(
                "workbench.home.projects.sharedProject.historyUnavailable",
              )}
            />
          ) : history.messages.length === 0 ? (
            <Empty
              description={t(
                "workbench.home.projects.sharedProject.emptyMessages",
              )}
            />
          ) : (
            <>
              {history.has_more && (
                <Button
                  block
                  loading={historyLoading}
                  onClick={() =>
                    void loadHistory(
                      activeThread.thread_id,
                      history.next_offset,
                    )
                  }
                >
                  {t("workbench.home.projects.sharedProject.loadOlder")}
                </Button>
              )}
              {history.messages.map((item, index) => (
                <article
                  key={`${item.created_at}-${index}`}
                  className="shared-project-message"
                >
                  <Typography.Text type="secondary">
                    {item.role === "assistant"
                      ? t(
                          "workbench.home.projects.sharedProject.senderAssistant",
                        )
                      : t("workbench.home.projects.sharedProject.senderUser")}
                  </Typography.Text>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {item.content}
                  </ReactMarkdown>
                </article>
              ))}
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
