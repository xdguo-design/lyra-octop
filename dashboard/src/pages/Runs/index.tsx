import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import {
  runsApi,
  type RunArtifact,
  type Run,
  type RunEvent,
  type RunEffect,
  type RunStatus,
  type RunStep,
} from "../../api/modules/runs";
import { listThreadFiles, type ChatFileSummary } from "../../api/modules/files";
import { downloadAuthFile } from "../../components/AuthFileDownloadLink";
import { message } from "../../utils/antdMessage";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import PageShell from "../../layouts/PageShell";

const PAGE_SIZE = 20;
const RUN_STATUSES: RunStatus[] = [
  "created",
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "interrupted",
  "unknown_external_effect",
];

const CANCELLABLE_STATUSES = new Set<RunStatus>([
  "created",
  "queued",
  "running",
  "waiting_approval",
]);

function statusLabel(
  t: (key: string, options?: { defaultValue?: string }) => string,
  status: string,
) {
  return t(`workbench.home.projects.runStatus.${status}`, {
    defaultValue: status,
  });
}

function RunStatusTag({ status }: { status: RunStatus }) {
  const { t } = useTranslation();
  const color =
    status === "succeeded" || status === "cancelled"
      ? "success"
      : status === "failed" || status === "unknown_external_effect"
      ? "error"
      : status === "waiting_approval" || status === "cancel_requested"
      ? "warning"
      : "processing";
  return <Tag color={color}>{statusLabel(t, status)}</Tag>;
}

function RunListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timezone = useServerTimezone();
  const [status, setStatus] = useState<RunStatus | undefined>();
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void runsApi
      .list(undefined, {
        status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((items) => {
        if (!active) return;
        setRuns(items);
        setHasNext(items.length === PAGE_SIZE);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshKey, status]);

  const columns: ColumnsType<Run> = [
    {
      title: t("runsPage.runId"),
      dataIndex: "run_id",
      key: "run_id",
      render: (value: string) => (
        <Typography.Text code copyable>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: t("runsPage.status"),
      dataIndex: "status",
      key: "status",
      render: (value: RunStatus) => <RunStatusTag status={value} />,
    },
    {
      title: t("runsPage.agent"),
      dataIndex: "agent_id",
      key: "agent_id",
    },
    {
      title: t("runsPage.project"),
      dataIndex: "project_id",
      key: "project_id",
      render: (value: string | null) => value ?? t("runsPage.noProject"),
    },
    {
      title: t("runsPage.createdAt"),
      dataIndex: "created_at",
      key: "created_at",
      render: (value: number) => formatServerDateTime(value, timezone),
    },
    {
      title: t("runsPage.actions"),
      key: "actions",
      render: (_value, run) => (
        <Button
          type="link"
          onClick={() => navigate(`/runs/${encodeURIComponent(run.run_id)}`)}
        >
          {t("runsPage.viewDetails")}
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      title={t("runsPage.title")}
      subtitle={t("runsPage.subtitle")}
      fill
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert type="info" showIcon message={t("runsPage.dataNote")} />
        <Space wrap>
          <Select
            allowClear
            placeholder={t("runsPage.filterStatus")}
            value={status}
            onChange={(value: RunStatus | undefined) => {
              setPage(0);
              setStatus(value);
            }}
            options={RUN_STATUSES.map((value) => ({
              value,
              label: statusLabel(t, value),
            }))}
            style={{ minWidth: 180 }}
          />
          <Button
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            {t("common.refresh")}
          </Button>
        </Space>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={t("runsPage.loadFailed")}
            action={
              <Button
                size="small"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <Spin spinning={loading}>
            <Table
              rowKey="run_id"
              columns={columns}
              dataSource={runs}
              pagination={false}
              scroll={{ x: 820 }}
              locale={{
                emptyText: <Empty description={t("runsPage.empty")} />,
              }}
            />
          </Spin>
        )}
        {!loadError && (page > 0 || hasNext) ? (
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button
              disabled={page === 0 || loading}
              onClick={() => setPage(page - 1)}
            >
              {t("runsPage.previous")}
            </Button>
            <Typography.Text>
              {t("runsPage.pageNumber", { page: page + 1 })}
            </Typography.Text>
            <Button
              disabled={!hasNext || loading}
              onClick={() => setPage(page + 1)}
            >
              {t("runsPage.next")}
            </Button>
          </Space>
        ) : null}
      </Space>
    </PageShell>
  );
}

function RunDetailPage({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timezone = useServerTimezone();
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [effects, setEffects] = useState<RunEffect[]>([]);
  const [threadFiles, setThreadFiles] = useState<ChatFileSummary[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      runsApi.get(runId),
      runsApi.steps(runId),
      runsApi.events(runId),
      runsApi.artifacts(runId),
      runsApi.effects(runId),
    ])
      .then(
        async ([
          nextRun,
          nextSteps,
          nextEvents,
          nextArtifacts,
          nextEffects,
        ]) => {
          if (!active) return;
          setRun(nextRun);
          setSteps(nextSteps);
          setEvents(nextEvents);
          setArtifacts(nextArtifacts);
          setEffects(nextEffects);
          const files = nextRun.thread_id
            ? await listThreadFiles(nextRun.agent_id, nextRun.thread_id).catch(
                () => [],
              )
            : [];
          if (active) setThreadFiles(files);
        },
      )
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, runId]);

  const cancelRun = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      const updated = await runsApi.cancel(run.run_id);
      setRun(updated);
      setRefreshKey((value) => value + 1);
      message.success(
        t(
          updated.status === "cancelled"
            ? "runsPage.cancelled"
            : "runsPage.cancelRequested",
        ),
      );
    } catch {
      message.error(t("runsPage.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  };

  const attachArtifact = async () => {
    const file = threadFiles.find((item) => item.file_id === selectedFileId);
    if (!run || !file?.current_revision_id) return;
    setAttaching(true);
    try {
      const artifact = await runsApi.attachArtifact(
        run.run_id,
        file.file_id,
        file.current_revision_id,
      );
      setArtifacts((current) =>
        current.some((item) => item.artifact_id === artifact.artifact_id)
          ? current
          : [...current, artifact],
      );
      setSelectedFileId(undefined);
      message.success(t("runsPage.artifactAttached"));
    } catch {
      message.error(t("runsPage.artifactAttachFailed"));
    } finally {
      setAttaching(false);
    }
  };

  return (
    <PageShell title={t("runsPage.detailTitle")} subtitle={runId} fill>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>
          <Button
            icon={<ArrowLeft size={14} />}
            onClick={() => navigate("/runs")}
          >
            {t("runsPage.backToList")}
          </Button>
          <Button
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            {t("common.refresh")}
          </Button>
          {run && CANCELLABLE_STATUSES.has(run.status) ? (
            <Popconfirm
              title={t("runsPage.cancelConfirm")}
              onConfirm={() => void cancelRun()}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
            >
              <Button danger loading={cancelling}>
                {t("runsPage.cancelRun")}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={t("runsPage.detailLoadFailed")}
          />
        ) : loading && !run ? (
          <Spin />
        ) : run ? (
          <>
            <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label={t("runsPage.status")}>
                <RunStatusTag status={run.status} />
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.agent")}>
                {run.agent_id}
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.agentVersion")}>
                {run.agent_version_id ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.project")}>
                {run.project_id ?? t("runsPage.noProject")}
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.createdAt")}>
                {formatServerDateTime(run.created_at, timezone)}
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.startedAt")}>
                {run.started_at
                  ? formatServerDateTime(run.started_at, timezone)
                  : t("runsPage.notStarted")}
              </Descriptions.Item>
              <Descriptions.Item label={t("runsPage.finishedAt")}>
                {run.finished_at
                  ? formatServerDateTime(run.finished_at, timezone)
                  : "—"}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>
              {t("runsPage.artifacts", { count: artifacts.length })}
            </Typography.Title>
            {run.thread_id ? (
              <Space wrap>
                <Select
                  allowClear
                  placeholder={t("runsPage.selectArtifact")}
                  value={selectedFileId}
                  onChange={setSelectedFileId}
                  options={threadFiles
                    .filter((file) => file.current_revision_id)
                    .map((file) => ({
                      value: file.file_id,
                      label: `${file.display_name} · ${file.byte_size} B`,
                    }))}
                  style={{ minWidth: 260 }}
                />
                <Button
                  disabled={!selectedFileId}
                  loading={attaching}
                  onClick={() => void attachArtifact()}
                >
                  {t("runsPage.attachArtifact")}
                </Button>
              </Space>
            ) : null}
            {artifacts.length ? (
              <Space direction="vertical" size={4}>
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
                          message.error(t("runsPage.artifactDownloadFailed")),
                        )
                      }
                    >
                      {t("runsPage.downloadArtifact")}
                    </Button>
                  </Space>
                ))}
              </Space>
            ) : (
              <Empty description={t("runsPage.noArtifacts")} />
            )}
            <Typography.Title level={5}>
              {t("runsPage.effects", { count: effects.length })}
            </Typography.Title>
            {effects.length ? (
              <Space direction="vertical" size={4}>
                {effects.map((effect) => (
                  <Space key={effect.effect_id} wrap>
                    <Tag
                      color={effect.status === "unknown" ? "orange" : undefined}
                    >
                      {t(`runsPage.effectStatus.${effect.status}`)}
                    </Tag>
                    <Typography.Text code>{effect.scope}</Typography.Text>
                  </Space>
                ))}
              </Space>
            ) : (
              <Empty description={t("runsPage.noEffects")} />
            )}
            {effects.some((effect) => effect.status === "unknown") ? (
              <Alert
                type="warning"
                showIcon
                message={t("runsPage.unknownEffectNote")}
              />
            ) : null}
            <Typography.Title level={5}>
              {t("runsPage.capabilityScopes")}
            </Typography.Title>
            <Alert
              type="info"
              showIcon
              message={t("runsPage.capabilityScopesAuditNote")}
              description={
                run.capability_scope_snapshot.length ? (
                  <Space direction="vertical" size={4}>
                    {run.capability_scope_snapshot.map((grant) => (
                      <Typography.Text key={grant.grant_id}>
                        <strong>{grant.app_key}</strong>
                        {" · "}
                        {t("runsPage.readScopes")}:{" "}
                        {grant.read_scopes.join(", ") || "—"}
                        {" · "}
                        {t("runsPage.writeScopes")}:{" "}
                        {grant.write_scopes.join(", ") || "—"}
                      </Typography.Text>
                    ))}
                  </Space>
                ) : (
                  t("runsPage.noCapabilityScopes")
                )
              }
            />
            {run.status === "cancel_requested" ? (
              <Alert
                type="warning"
                showIcon
                message={t("runsPage.cancelPendingNote")}
              />
            ) : null}
            <Typography.Title level={5}>
              {t("runsPage.steps", { count: steps.length })}
            </Typography.Title>
            {steps.length ? (
              <Timeline
                items={steps.map((step) => ({
                  children: (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>
                        {step.kind} · {step.executor}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {statusLabel(t, step.status)} ·{" "}
                        {t("runsPage.attempt", { count: step.attempt })}
                      </Typography.Text>
                    </Space>
                  ),
                }))}
              />
            ) : (
              <Empty description={t("runsPage.noSteps")} />
            )}
            <Typography.Title level={5}>
              {t("runsPage.events", { count: events.length })}
            </Typography.Title>
            {events.length ? (
              <Timeline
                items={events.map((event) => ({
                  children: (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>
                        #{event.sequence} · {event.type}
                      </Typography.Text>
                      {event.payload?.error_code ? (
                        <Typography.Text type="danger">
                          {t(`runsPage.errorCodes.${event.payload.error_code}`)}
                        </Typography.Text>
                      ) : null}
                      <Typography.Text type="secondary">
                        {formatServerDateTime(event.created_at, timezone)}
                      </Typography.Text>
                    </Space>
                  ),
                }))}
              />
            ) : (
              <Empty description={t("runsPage.noEvents")} />
            )}
          </>
        ) : null}
      </Space>
    </PageShell>
  );
}

export default function RunsPage() {
  const { runId } = useParams<{ runId?: string }>();
  return runId ? <RunDetailPage runId={runId} /> : <RunListPage />;
}
