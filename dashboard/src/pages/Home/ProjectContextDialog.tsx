import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Input, Modal, Spin } from "antd";
import { useTranslation } from "react-i18next";
import {
  workbenchApi,
  type ProjectContext,
  type WorkbenchProject,
} from "../../api/modules/workbench";
import { apiErrorMessage } from "../../utils/apiError";
import { message } from "../../utils/antdMessage";

interface ProjectContextDialogProps {
  project: WorkbenchProject | null;
  onClose: () => void;
}

export default function ProjectContextDialog({
  project,
  onClose,
}: ProjectContextDialogProps) {
  const { t } = useTranslation();
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!project) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(false);
    try {
      const current = await workbenchApi.getProjectContext(project.project_id);
      if (sequence !== loadSequence.current) return;
      setContext(current);
      setInstructions(current.instructions);
    } catch {
      if (sequence === loadSequence.current) setLoadError(true);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadSequence.current += 1;
    setContext(null);
    setInstructions("");
    if (project) void load();
  }, [load, project]);

  const save = async () => {
    if (!project || !context || saving) return;
    setSaving(true);
    try {
      await workbenchApi.updateProjectContext(
        project.project_id,
        instructions,
        context.instructions_revision,
      );
      message.success(t("workbench.home.projects.contextSaved"));
      onClose();
    } catch (error) {
      message.error(
        apiErrorMessage(
          error,
          t("workbench.home.projects.contextSaveFailed"),
          t,
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("workbench.home.projects.editContextTitle", {
        name: project?.name ?? "",
      })}
      open={project !== null}
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={saving}
      okButtonProps={{ disabled: !context || loading || loadError }}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={t("workbench.home.projects.contextLoadFailed")}
            action={
              <button type="button" onClick={() => void load()}>
                {t("common.retry")}
              </button>
            }
          />
        ) : (
          <>
            <p>{t("workbench.home.projects.contextHint")}</p>
            <Input.TextArea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={20_000}
              showCount
              autoSize={{ minRows: 6, maxRows: 16 }}
              disabled={!context || loading}
            />
          </>
        )}
      </Spin>
    </Modal>
  );
}
