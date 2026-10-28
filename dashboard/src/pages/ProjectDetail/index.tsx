import { useEffect, useState } from "react";
import { Alert, Button, Card, List, Space, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { workbenchApi, type WorkbenchIndex } from "../../api/modules/workbench";
import PageShell from "../../layouts/PageShell";
import ProjectCodeBrowser from "../Home/ProjectCodeBrowser";
import ProjectContextDialog from "../Home/ProjectContextDialog";
import ProjectRunsDialog from "../Home/ProjectRunsDialog";
import ProjectShareDialog from "../Home/ProjectShareDialog";

export default function ProjectDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const [index, setIndex] = useState<WorkbenchIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<
    "context" | "runs" | "share" | "code" | null
  >(null);

  useEffect(() => {
    let active = true;
    setDialog(null);
    setIndex(null);
    setError(false);
    setLoading(true);
    void workbenchApi
      .get()
      .then((data) => {
        if (active) setIndex(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, refresh]);

  const project = index?.projects.find((item) => item.project_id === projectId);
  const folders =
    index?.folders.filter((item) => item.project_id === projectId) ?? [];
  const threads =
    index?.assignments.filter((item) => item.project_id === projectId) ?? [];

  return (
    <PageShell title={t("projectDetailsPage.title")}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Button onClick={() => navigate("/home")}>
          {t("projectDetailsPage.back")}
        </Button>
        {loading ? (
          <Spin />
        ) : error ? (
          <Alert
            type="error"
            showIcon
            message={t("projectDetailsPage.loadFailed")}
            action={
              <Button
                size="small"
                onClick={() => setRefresh((value) => value + 1)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : !project ? (
          <Alert
            type="warning"
            showIcon
            message={t("projectDetailsPage.notFound")}
          />
        ) : (
          <>
            <Typography.Title level={3}>{project.name}</Typography.Title>
            <Space wrap>
              {project.code_enabled && (
                <Button onClick={() => setDialog("code")}>
                  {t("workbench.home.projects.viewCode")}
                </Button>
              )}
              <Button onClick={() => setDialog("context")}>
                {t("workbench.home.projects.editContext")}
              </Button>
              <Button onClick={() => setDialog("runs")}>
                {t("workbench.home.projects.runHistory")}
              </Button>
              <Button onClick={() => setDialog("share")}>
                {t("workbench.home.projects.shareProject")}
              </Button>
            </Space>
            <Card title={t("projectDetailsPage.folders")}>
              <List
                dataSource={folders}
                locale={{ emptyText: t("projectDetailsPage.noFolders") }}
                renderItem={(folder) => <List.Item>{folder.name}</List.Item>}
              />
            </Card>
            <Card title={t("projectDetailsPage.threads")}>
              <List
                dataSource={threads}
                locale={{ emptyText: t("projectDetailsPage.noThreads") }}
                renderItem={(thread) => (
                  <List.Item>
                    <Typography.Text code>{thread.thread_id}</Typography.Text>
                  </List.Item>
                )}
              />
            </Card>
            <Alert
              type="info"
              showIcon
              message={t("projectDetailsPage.membersUnavailable")}
            />
            <ProjectContextDialog
              project={dialog === "context" ? project : null}
              onClose={() => setDialog(null)}
            />
            <ProjectRunsDialog
              project={dialog === "runs" ? project : null}
              onClose={() => setDialog(null)}
            />
            <ProjectShareDialog
              project={dialog === "share" ? project : null}
              onClose={() => setDialog(null)}
            />
            {dialog === "code" && (
              <ProjectCodeBrowser
                projectId={project.project_id}
                open
                onClose={() => setDialog(null)}
              />
            )}
          </>
        )}
      </Space>
    </PageShell>
  );
}
