import {
  Button,
  Drawer,
  Descriptions,
  Badge,
  Tag,
  Typography,
  Divider,
  Alert,
  Empty,
  List,
  Space,
  Spin,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import type { CronJobSpecOutput } from "../../../../api/types";
import { octopCronApi, type OctopCronRun } from "../../../../api/modules/cronjob";
import { setPendingPrefillText } from "../../../Chat/hooks/chatStore";
import {
  channelFromSessionKey,
  extractPromptFromJob,
  formatCronTimestamp,
} from "../cronDisplay";

const { Text } = Typography;

type CronJob = CronJobSpecOutput;

interface JobDetailDrawerProps {
  open: boolean;
  job: CronJob | null;
  agentId: string | null;
  timeZone: string;
  onClose: () => void;
}

export function JobDetailDrawer({
  open,
  job,
  agentId,
  timeZone,
  onClose,
}: JobDetailDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<OctopCronRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const cronId = job?.id;

  const refreshRuns = useCallback(async () => {
    if (!agentId || !cronId) return;
    setRunsLoading(true);
    try {
      setRuns(await octopCronApi.runs(agentId, cronId));
      setRunsError(false);
    } catch (error) {
      setRunsError(true);
      console.error("Failed to load cron run history", error);
    } finally {
      setRunsLoading(false);
    }
  }, [agentId, cronId]);
  const hasRunningRun = runs.some((run) => run.status === "running");

  useEffect(() => {
    if (!open || !agentId || !cronId) {
      setRuns([]);
      return;
    }
    let active = true;
    let requestPending = false;
    const load = async () => {
      if (requestPending) return;
      requestPending = true;
      setRunsLoading(true);
      try {
        const history = await octopCronApi.runs(agentId, cronId);
        if (active) {
          setRuns(history);
          setRunsError(false);
        }
      } catch (error) {
        if (active) {
          setRunsError(true);
          console.error("Failed to load cron run history", error);
        }
      } finally {
        requestPending = false;
        if (active) setRunsLoading(false);
      }
    };
    void load();
    const timer = hasRunningRun
      ? window.setInterval(() => {
          if (active) void load();
        }, 3000)
      : undefined;
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [agentId, cronId, hasRunningRun, open]);

  const cancelRun = async (run: OctopCronRun) => {
    if (!agentId || !cronId) return;
    setCancellingRunId(run.run_id);
    try {
      const result = await octopCronApi.cancelRun(agentId, cronId, run.run_id);
      await refreshRuns();
      message[result.cancelled ? "success" : "info"](
        t(result.cancelled ? "cronJobs.runCancelled" : "cronJobs.runCancelUnavailable"),
      );
    } catch (error) {
      console.error("Failed to cancel cron run", error);
      message.error(t("cronJobs.runCancelFailed"));
    } finally {
      setCancellingRunId(null);
    }
  };

  if (!job) return null;

  const meta = (job.meta as Record<string, unknown> | undefined) ?? {};
  const sessionKey =
    typeof meta.octop_session_key === "string" ? meta.octop_session_key : "";
  const channel = sessionKey
    ? channelFromSessionKey(sessionKey)
    : String(job.dispatch?.channel || "—");
  const agentPrompt = extractPromptFromJob(job) || null;
  const lastStatus =
    typeof meta.octop_last_status === "string" ? meta.octop_last_status : "";
  const lastError =
    typeof meta.octop_last_error === "string" && meta.octop_last_error.trim()
      ? meta.octop_last_error
      : null;

  const handleGoToChat = () => {
    onClose();
    setPendingPrefillText(agentPrompt ?? "");
    navigate("/chat", { state: { prefillInput: agentPrompt ?? "" } });
  };

  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge
            status={job.enabled ? "success" : "default"}
            text={
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {job.name || job.id}
              </span>
            }
          />
        </div>
      }
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
      footer={
        agentPrompt ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="primary"
              icon={<MessageSquare size={14} />}
              onClick={handleGoToChat}
            >
              {t("cronJobs.goToChat", "发送到聊天")}
            </Button>
          </div>
        ) : null
      }
    >
      {/* Basic information */}
      <Divider
        orientation="left"
        orientationMargin={0}
        style={{ fontSize: 13, fontWeight: 600, marginTop: 0 }}
      >
        {t("cronJobs.form.sectionBasic")}
      </Divider>
      <Descriptions
        column={1}
        size="small"
        labelStyle={{ color: "var(--fn-text-tertiary)", width: 120 }}
      >
        <Descriptions.Item label={t("cronJobs.col.id")}>
          <Text copyable style={{ fontSize: 12, fontFamily: "monospace" }}>
            {job.id}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("cronJobs.col.name")}>
          {job.name || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("common.enabled")}>
          {job.enabled ? (
            <Tag color="success">{t("common.enabled")}</Tag>
          ) : (
            <Tag color="default">{t("common.disabled")}</Tag>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Divider
        orientation="left"
        orientationMargin={0}
        style={{ fontSize: 13, fontWeight: 600 }}
      >
        {t("cronJobs.runHistory")}
      </Divider>
      {runsError && runs.length === 0 ? (
        <Alert type="error" showIcon message={t("cronJobs.runHistoryFailed")} />
      ) : runsLoading && runs.length === 0 ? (
        <Spin />
      ) : runs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("cronJobs.noRuns")} />
      ) : (
        <List
          size="small"
          dataSource={runs}
          renderItem={(run) => (
            <List.Item
              actions={
                run.status === "running"
                  ? [
                      <Button
                        key="cancel"
                        type="link"
                        danger
                        loading={cancellingRunId === run.run_id}
                        onClick={() => void cancelRun(run)}
                      >
                        {t("cronJobs.cancelRun")}
                      </Button>,
                    ]
                  : undefined
              }
            >
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Space>
                  <Tag
                    color={
                      run.status === "ok"
                        ? "success"
                        : run.status === "error"
                          ? "error"
                          : run.status === "running"
                            ? "processing"
                            : "default"
                    }
                  >
                    {t(`cronJobs.runStatus.${run.status}`, run.status)}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t(`cronJobs.runTrigger.${run.trigger_kind}`, run.trigger_kind)}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatCronTimestamp(run.started_at, timeZone)}
                  </Text>
                </Space>
                {run.error ? (
                  <Text type="danger" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {run.error}
                  </Text>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
      )}

      {/* Schedule settings */}
      <Divider
        orientation="left"
        orientationMargin={0}
        style={{ fontSize: 13, fontWeight: 600 }}
      >
        {t("cronJobs.form.sectionSchedule")}
      </Divider>
      <Descriptions
        column={1}
        size="small"
        labelStyle={{ color: "var(--fn-text-tertiary)", width: 120 }}
      >
        <Descriptions.Item label={t("cronJobs.col.trigger")}>
          <Text code style={{ fontSize: 12 }}>
            {job.schedule?.cron?.startsWith("agently:")
              ? t("cronJobs.form.agentlyNewMail")
              : job.schedule?.cron || "—"}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("cronJobs.form.timezone")}>
          {job.schedule?.timezone || "—"}
        </Descriptions.Item>
        <Descriptions.Item label={t("cronJobs.col.lastRunAt")}>
          {formatCronTimestamp(
            typeof meta.octop_last_run_at === "number"
              ? meta.octop_last_run_at
              : null,
            timeZone,
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t("cronJobs.col.lastStatus")}>
          {lastStatus ? (
            <Tag
              color={
                lastStatus === "error"
                  ? "error"
                  : lastStatus === "ok"
                  ? "success"
                  : "default"
              }
            >
              {lastStatus}
            </Tag>
          ) : (
            "—"
          )}
        </Descriptions.Item>
        {lastError && (
          <Descriptions.Item label={t("cronJobs.col.lastError")}>
            <Alert
              type="error"
              showIcon
              message={
                <Text style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {lastError}
                </Text>
              }
              style={{ padding: "8px 12px" }}
            />
          </Descriptions.Item>
        )}
      </Descriptions>

      <Divider
        orientation="left"
        orientationMargin={0}
        style={{ fontSize: 13, fontWeight: 600 }}
      >
        {t("cronJobs.form.sectionTask")}
      </Divider>
      <Descriptions
        column={1}
        size="small"
        labelStyle={{ color: "var(--fn-text-tertiary)", width: 120 }}
      >
        <Descriptions.Item label={t("cronJobs.col.taskType")}>
          {job.task_type === "text"
            ? t("cronJobs.form.taskTypeText")
            : t("cronJobs.form.taskTypeAgent")}
        </Descriptions.Item>
        {agentPrompt && (
          <Descriptions.Item label={t("cronJobs.col.prompt")}>
            <Text style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              {agentPrompt}
            </Text>
          </Descriptions.Item>
        )}
        {job.model || meta.octop_model ? (
          <Descriptions.Item label={t("cronJobs.form.model")}>
            {String(job.model || meta.octop_model)}
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t("cronJobs.col.freshThread")}>
          {meta.octop_fresh_thread
            ? t("cronJobs.col.freshThreadOn")
            : t("cronJobs.col.freshThreadOff")}
        </Descriptions.Item>
      </Descriptions>

      <Divider
        orientation="left"
        orientationMargin={0}
        style={{ fontSize: 13, fontWeight: 600 }}
      >
        {t("cronJobs.form.sectionRouting")}
      </Divider>
      <Descriptions
        column={1}
        size="small"
        labelStyle={{ color: "var(--fn-text-tertiary)", width: 120 }}
      >
        <Descriptions.Item label={t("cronJobs.col.dispatchChannel")}>
          {channel}
        </Descriptions.Item>
        {sessionKey && (
          <Descriptions.Item label={t("cronJobs.col.sessionKey")}>
            <Text copyable style={{ fontSize: 12, fontFamily: "monospace" }}>
              {sessionKey}
            </Text>
          </Descriptions.Item>
        )}
      </Descriptions>
    </Drawer>
  );
}
