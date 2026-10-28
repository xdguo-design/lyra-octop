import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, List, Modal, Space, Spin, Tag, Typography } from "antd";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  runsApi,
  type Run,
  type RunArtifact,
  type RunEvent,
  type RunStep,
  type TeamRunChild,
} from "../../api/modules/runs";
import type { WorkbenchProject } from "../../api/modules/workbench";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { downloadAuthFile } from "../../components/AuthFileDownloadLink";
import { message } from "../../utils/antdMessage";

interface ProjectRunsDialogProps {
  project: WorkbenchProject | null;
  onClose: () => void;
}

export default function ProjectRunsDialog({
  project,
  onClose,
}: ProjectRunsDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timezone = useServerTimezone();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [children, setChildren] = useState<TeamRunChild[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [projectArtifacts, setProjectArtifacts] = useState<RunArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const loadSequence = useRef(0);
  const detailSequence = useRef(0);

  const load = useCallback(async () => {
    if (!project) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [current, currentArtifacts] = await Promise.all([
        runsApi.list(project.project_id),
        runsApi.projectArtifacts(project.project_id),
      ]);
      if (sequence === loadSequence.current) {
        setRuns(current);
        setProjectArtifacts(currentArtifacts);
      }
    } catch {
      if (sequence === loadSequence.current) setLoadError(true);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadSequence.current += 1;
    setRuns([]);
    setSelectedRun(null);
    setSteps([]);
    setChildren([]);
    setEvents([]);
    setArtifacts([]);
    setProjectArtifacts([]);
    detailSequence.current += 1;
    if (project) void load();
  }, [load, project]);

  const showDetails = async (run: Run) => {
    if (selectedRun === run.run_id) {
      setSelectedRun(null);
      return;
    }
    setSelectedRun(run.run_id);
    setSteps([]);
    setChildren([]);
    setEvents([]);
    setArtifacts([]);
    const sequence = ++detailSequence.current;
    setDetailsLoading(true);
    setDetailsError(false);
    try {
      const [nextSteps, nextEvents, nextChildren, nextArtifacts] =
        await Promise.all([
          runsApi.steps(run.run_id),
          runsApi.events(run.run_id),
          runsApi.children(run.run_id),
          runsApi.artifacts(run.run_id),
        ]);
      if (sequence === detailSequence.current) {
        setSteps(nextSteps);
        setEvents(nextEvents);
        setChildren(nextChildren);
        setArtifacts(nextArtifacts);
      }
    } catch {
      if (sequence === detailSequence.current) setDetailsError(true);
    } finally {
      if (sequence === detailSequence.current) setDetailsLoading(false);
    }
  };
  const selectedRunRecord = runs.find((item) => item.run_id === selectedRun);

  return (
    <Modal
      title={t("workbench.home.projects.runHistoryTitle", {
        name: project?.name ?? "",
      })}
      open={project !== null}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message={t("workbench.home.projects.runHistoryLoadFailed")}
          action={
            <Button size="small" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <Spin spinning={loading}>
          <List
            locale={{
              emptyText: t("workbench.home.projects.runHistoryEmpty"),
            }}
            dataSource={runs}
            renderItem={(run) => (
              <List.Item
                key={run.run_id}
                actions={[
                  <Button
                    key="details"
                    type="link"
                    onClick={() => void showDetails(run)}
                  >
                    {t(
                      selectedRun === run.run_id
                        ? "workbench.home.projects.hideRunDetails"
                        : "workbench.home.projects.viewRunDetails",
                    )}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <Tag>
                        {t(`workbench.home.projects.runStatus.${run.status}`)}
                      </Tag>
                      <Typography.Text type="secondary">
                        {formatServerDateTime(run.created_at, timezone)}
                      </Typography.Text>
                    </Space>
                  }
                  description={t("workbench.home.projects.runAgent", {
                    agent: run.agent_id,
                  })}
                />
              </List.Item>
            )}
          />
        </Spin>
      )}
      {!loadError && (
        <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
          <Typography.Title level={5}>
            {t("workbench.home.projects.projectArtifacts", {
              count: projectArtifacts.length,
            })}
          </Typography.Title>
          {projectArtifacts.length === 0 ? (
            <Typography.Text type="secondary">
              {t("workbench.home.projects.projectArtifactsEmpty")}
            </Typography.Text>
          ) : (
            projectArtifacts.map((artifact) => (
              <Space key={artifact.artifact_id} wrap>
                <Typography.Text>{artifact.display_name}</Typography.Text>
                <Typography.Text type="secondary" code>
                  {artifact.revision_id}
                </Typography.Text>
                <Button
                  type="link"
                  icon={<Download size={14} />}
                  onClick={() =>
                    void downloadAuthFile(artifact.content_url, {
                      filename: artifact.display_name,
                    }).catch(() =>
                      message.error(
                        t("workbench.home.projects.runArtifactDownloadFailed"),
                      ),
                    )
                  }
                >
                  {t("workbench.home.projects.downloadRunArtifact")}
                </Button>
              </Space>
            ))
          )}
        </Space>
      )}
      {selectedRun && (
        <Spin spinning={detailsLoading}>
          {detailsError ? (
            <Alert
              type="error"
              showIcon
              message={t("workbench.home.projects.runDetailsLoadFailed")}
            />
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              {selectedRunRecord && (
                <>
                  {selectedRunRecord.status === "waiting_approval" &&
                  selectedRunRecord.thread_id ? (
                    <Button
                      type="primary"
                      onClick={() =>
                        navigate(
                          `/chat/${encodeURIComponent(
                            selectedRunRecord.agent_id,
                          )}/${encodeURIComponent(
                            selectedRunRecord.thread_id!,
                          )}`,
                        )
                      }
                    >
                      {t("workbench.home.projects.openRunApproval")}
                    </Button>
                  ) : null}
                  <Typography.Title level={5}>
                    {t("workbench.home.projects.runContextTitle")}
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    {t("workbench.home.projects.runContextRevision", {
                      revision:
                        selectedRunRecord.project_context_snapshot
                          ?.instructions_revision ?? 0,
                    })}
                    {" · "}
                    {t("workbench.home.projects.runContextKnowledgeBases", {
                      count:
                        selectedRunRecord.project_context_snapshot
                          ?.knowledge_base_ids.length ?? 0,
                    })}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {t("workbench.home.projects.runContextFiles", {
                      count: selectedRunRecord.source_file_revisions.length,
                    })}
                  </Typography.Text>
                  {selectedRunRecord.source_file_revisions.map((source) => (
                    <Typography.Text key={source.revision_id} type="secondary">
                      {source.file_id} · {source.revision_id} ·{" "}
                      {source.content_hash}
                    </Typography.Text>
                  ))}
                </>
              )}
              <Typography.Title level={5}>
                {t("workbench.home.projects.runSteps", { count: steps.length })}
              </Typography.Title>
              {steps.map((step) => (
                <Typography.Text key={step.step_id}>
                  {step.kind} · {step.executor} ·{" "}
                  {t(`workbench.home.projects.runStatus.${step.status}`)}
                </Typography.Text>
              ))}
              <Typography.Title level={5}>
                {t("workbench.home.projects.teamRuns", {
                  count: children.length,
                })}
              </Typography.Title>
              {children.map((child) => (
                <Typography.Text key={child.run_id}>
                  {child.agent_id} ·{" "}
                  {t(`workbench.home.projects.runStatus.${child.status}`)}
                </Typography.Text>
              ))}
              <Typography.Title level={5}>
                {t("workbench.home.projects.runEvents", {
                  count: events.length,
                })}
              </Typography.Title>
              {events.map((event) => (
                <Typography.Text key={event.event_id}>
                  #{event.sequence} · {event.type} ·{" "}
                  {formatServerDateTime(event.created_at, timezone)}
                  {event.payload?.error_code ? (
                    <Typography.Text type="danger">
                      {" · "}
                      {t(`runsPage.errorCodes.${event.payload.error_code}`)}
                    </Typography.Text>
                  ) : null}
                </Typography.Text>
              ))}
              <Typography.Title level={5}>
                {t("workbench.home.projects.runArtifacts", {
                  count: artifacts.length,
                })}
              </Typography.Title>
              {artifacts.map((artifact) => (
                <Space key={artifact.artifact_id} wrap>
                  <Typography.Text>{artifact.display_name}</Typography.Text>
                  <Typography.Text type="secondary" code>
                    {artifact.revision_id}
                  </Typography.Text>
                  <Button
                    type="link"
                    icon={<Download size={14} />}
                    onClick={() =>
                      void downloadAuthFile(artifact.content_url, {
                        filename: artifact.display_name,
                      }).catch(() =>
                        message.error(
                          t(
                            "workbench.home.projects.runArtifactDownloadFailed",
                          ),
                        ),
                      )
                    }
                  >
                    {t("workbench.home.projects.downloadRunArtifact")}
                  </Button>
                </Space>
              ))}
            </Space>
          )}
        </Spin>
      )}
    </Modal>
  );
}
