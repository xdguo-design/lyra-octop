import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Space, Tag, Typography } from "antd";
import { Copy, Link2, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  workbenchApi,
  type CreatedProjectShare,
  type ProjectShare,
  type WorkbenchProject,
} from "../../api/modules/workbench";
import { message } from "../../utils/antdMessage";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { copyText } from "../../utils/copyText";

interface ProjectShareDialogProps {
  project: WorkbenchProject | null;
  onClose: () => void;
}

const EXPIRATIONS = [3600, 86400, 604800, 2592000];

function expiryLabel(t: TFunction, seconds: number) {
  return t(`workbench.home.projects.shareExpiryOptions.${seconds}`);
}

export default function ProjectShareDialog({
  project,
  onClose,
}: ProjectShareDialogProps) {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  const [expiresIn, setExpiresIn] = useState(86400);
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [created, setCreated] = useState<CreatedProjectShare | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    setExpiresIn(86400);
    setCreated(null);
    setBusy(true);
    void workbenchApi
      .listShares(project.project_id)
      .then(setShares)
      .catch(() => message.error(t("workbench.home.projects.shareLoadFailed")))
      .finally(() => setBusy(false));
  }, [project, t]);

  const createShare = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const share = await workbenchApi.createShare(
        project.project_id,
        expiresIn,
      );
      setCreated(share);
      setShares((current) => [share, ...current]);
    } catch {
      message.error(t("workbench.home.projects.shareCreateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    if (!project) return;
    setBusy(true);
    try {
      await workbenchApi.revokeShare(project.project_id, shareId);
      setShares((current) =>
        current.map((share) =>
          share.share_id === shareId
            ? { ...share, revoked_at: Math.floor(Date.now() / 1000) }
            : share,
        ),
      );
      if (created?.share_id === shareId) setCreated(null);
    } catch {
      message.error(t("workbench.home.projects.shareRevokeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!created) return;
    const url = `${window.location.origin}/share/${created.token}`;
    if (await copyText(url)) {
      message.success(t("workbench.home.projects.shareCopied"));
    } else {
      message.error(t("workbench.home.projects.shareCopyFailed"));
    }
  };

  return (
    <Modal
      title={t("workbench.home.projects.shareTitle", { name: project?.name })}
      open={!!project}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          {t("workbench.home.projects.shareHint")}
        </Typography.Text>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            aria-label={t("workbench.home.projects.shareExpiry")}
            value={expiresIn}
            onChange={setExpiresIn}
            options={EXPIRATIONS.map((seconds) => ({
              value: seconds,
              label: expiryLabel(t, seconds),
            }))}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<Share2 size={15} />}
            loading={busy}
            onClick={() => void createShare()}
          >
            {t("workbench.home.projects.createShare")}
          </Button>
        </Space.Compact>
        {created && (
          <Space.Compact style={{ width: "100%" }}>
            <Input
              aria-label={t("workbench.home.projects.shareLink")}
              readOnly
              value={`${window.location.origin}/share/${created.token}`}
            />
            <Button icon={<Copy size={15} />} onClick={() => void copyLink()}>
              {t("workbench.home.projects.copyShareLink")}
            </Button>
          </Space.Compact>
        )}
        {created && (
          <Typography.Text type="warning">
            {t("workbench.home.projects.shareLinkShownOnce")}
          </Typography.Text>
        )}
        <div>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("workbench.home.projects.shareLinks")}
          </Typography.Title>
          {shares.length === 0 ? (
            <Typography.Text type="secondary">
              {t("workbench.home.projects.noShareLinks")}
            </Typography.Text>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              {shares.map((share) => {
                const active =
                  !share.revoked_at && share.expires_at > Date.now() / 1000;
                return (
                  <Space key={share.share_id} style={{ width: "100%" }}>
                    <Link2 size={15} />
                    <Typography.Text>
                      {t("workbench.home.projects.shareExpiresAt", {
                        date: formatServerDateTime(share.expires_at, timezone),
                      })}
                    </Typography.Text>
                    <Tag color={active ? "green" : "default"}>
                      {active
                        ? t("workbench.home.projects.shareActive")
                        : t("workbench.home.projects.shareInactive")}
                    </Tag>
                    {active && (
                      <Button
                        size="small"
                        danger
                        disabled={busy}
                        onClick={() => void revokeShare(share.share_id)}
                      >
                        {t("workbench.home.projects.revokeShare")}
                      </Button>
                    )}
                  </Space>
                );
              })}
            </Space>
          )}
        </div>
      </Space>
    </Modal>
  );
}
