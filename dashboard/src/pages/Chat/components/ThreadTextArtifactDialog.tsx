import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Modal, Select, Space } from "antd";
import { useTranslation } from "react-i18next";
import {
  createTextFileRevision,
  createThreadTextFile,
  getFile,
  listThreadFiles,
  readTextFileRevision,
  type ChatFileSummary,
} from "../../../api/modules/files";

import { message as antMessage } from "@/utils/antdMessage";
import { diffTextLines } from "../utils/textDiff";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".docx"]);

function isTextArtifact(file: ChatFileSummary): boolean {
  const extension = file.display_name
    .slice(file.display_name.lastIndexOf("."))
    .toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extension) &&
    (extension !== ".docx" || file.origin_kind === "generated")
  );
}

function conflictRevisionId(error: unknown): string | null {
  const match = String(error).match(/"revision_id"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

export function ThreadTextArtifactDialog({
  open,
  agentId,
  threadId,
  onClose,
}: {
  open: boolean;
  agentId: string;
  threadId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<ChatFileSummary[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);
  const [filename, setFilename] = useState("draft.md");
  const [content, setContent] = useState("");
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    baseRevisionId: string;
    branchRevisionId: string | null;
    latestContent: string | null;
    draftContent: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadSequence = useRef(0);

  const textFiles = useMemo(() => files.filter(isTextArtifact), [files]);
  const selectedFile = textFiles.find((file) => file.file_id === fileId);
  const conflictDiff = useMemo(
    () =>
      conflict?.latestContent === null || !conflict
        ? null
        : diffTextLines(conflict.latestContent, content),
    [conflict, content],
  );

  const refreshFiles = async () => {
    const next = await listThreadFiles(agentId, threadId);
    setFiles(next);
    return next;
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFileId(null);
    setBaseRevisionId(null);
    setConflict(null);
    setContent("");
    setFilename("draft.md");
    void listThreadFiles(agentId, threadId)
      .then((rows) => {
        if (active) setFiles(rows);
      })
      .catch(() => {
        if (active) antMessage.error(t("chat.textArtifacts.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      loadSequence.current += 1;
    };
  }, [agentId, open, t, threadId]);

  useEffect(() => {
    const file = selectedFile;
    if (!open || !fileId || !file?.current_revision_id) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setConflict(null);
    void readTextFileRevision(
      agentId,
      file.file_id,
      file.current_revision_id,
      threadId,
    )
      .then((revision) => {
        if (sequence !== loadSequence.current) return;
        setFilename(file.display_name);
        setContent(revision.content);
        setBaseRevisionId(revision.revision_id);
      })
      .catch(() => {
        if (sequence === loadSequence.current)
          antMessage.error(t("chat.textArtifacts.loadFailed"));
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  }, [agentId, fileId, open, selectedFile, t, threadId]);

  const save = async (revisionBase = baseRevisionId) => {
    if (!filename.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (!fileId) {
        const created = await createThreadTextFile(agentId, threadId, {
          filename: filename.trim(),
          content,
        });
        setFiles(await refreshFiles());
        setFileId(created.file_id);
        setBaseRevisionId(created.current_revision_id);
        setConflict(null);
      } else if (revisionBase) {
        const revised = await createTextFileRevision(agentId, fileId, {
          thread_id: threadId,
          base_revision_id: revisionBase,
          content,
        });
        setFiles(await refreshFiles());
        setBaseRevisionId(revised.current_revision_id);
        setConflict(null);
      }
      antMessage.success(t("chat.textArtifacts.saved"));
    } catch (error) {
      if (fileId && String(error).includes("FILE_REVISION_CONFLICT")) {
        const branchRevisionId = conflictRevisionId(error);
        try {
          const detail = await getFile(agentId, fileId);
          if (detail.current_revision_id) {
            let latestContent: string | null = null;
            try {
              latestContent = (
                await readTextFileRevision(
                  agentId,
                  fileId,
                  detail.current_revision_id,
                  threadId,
                )
              ).content;
            } catch {
              // Preserve the local branch even if the concurrent revision cannot be read.
            }
            setConflict({
              baseRevisionId: detail.current_revision_id,
              branchRevisionId,
              latestContent,
              draftContent: content,
            });
            setBaseRevisionId(detail.current_revision_id);
          }
        } catch {
          antMessage.error(t("chat.textArtifacts.saveFailed"));
        }
      } else {
        antMessage.error(t("chat.textArtifacts.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("chat.textArtifacts.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            aria-label={t("chat.textArtifacts.existing")}
            allowClear
            loading={loading}
            placeholder={t("chat.textArtifacts.existing")}
            value={fileId ?? undefined}
            options={textFiles.map((file) => ({
              value: file.file_id,
              label: file.display_name,
            }))}
            onChange={(next) => {
              setFileId(next ?? null);
              setConflict(null);
              if (!next) {
                setFilename("draft.md");
                setContent("");
                setBaseRevisionId(null);
              }
            }}
          />
          <Button
            onClick={() => {
              setFileId(null);
              setFilename("draft.md");
              setContent("");
              setBaseRevisionId(null);
              setConflict(null);
            }}
          >
            {t("chat.textArtifacts.new")}
          </Button>
        </Space.Compact>
        <Input
          aria-label={t("chat.textArtifacts.filename")}
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
          disabled={Boolean(fileId)}
          maxLength={255}
        />
        <Input.TextArea
          aria-label={t("chat.textArtifacts.content")}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          autoSize={{ minRows: 10, maxRows: 20 }}
          maxLength={2_000_000}
          disabled={loading}
        />
        {conflict && (
          <div role="alert">
            {t("chat.textArtifacts.conflict", {
              branch:
                conflict.branchRevisionId ??
                t("chat.textArtifacts.unknownBranch"),
            })}
            {conflict.latestContent !== null && (
              <div>
                <div>{t("chat.textArtifacts.diffTitle")}</div>
                {conflictDiff ? (
                  <pre
                    role="region"
                    aria-label={t("chat.textArtifacts.diffTitle")}
                    style={{
                      maxHeight: 240,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {conflictDiff.map((line, index) => (
                      <span
                        key={index}
                        style={{
                          display: "block",
                          color:
                            line.kind === "added"
                              ? "#237804"
                              : line.kind === "removed"
                              ? "#a8071a"
                              : undefined,
                          background:
                            line.kind === "added"
                              ? "#f6ffed"
                              : line.kind === "removed"
                              ? "#fff1f0"
                              : undefined,
                        }}
                      >
                        {line.kind === "added"
                          ? "+ "
                          : line.kind === "removed"
                          ? "− "
                          : "  "}
                        {line.text || " "}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <div>{t("chat.textArtifacts.diffTooLarge")}</div>
                )}
                <div>{t("chat.textArtifacts.latestVersion")}</div>
                <pre
                  style={{
                    maxHeight: 200,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {conflict.latestContent}
                </pre>
              </div>
            )}
            <Button
              type="link"
              disabled={
                !conflict.baseRevisionId ||
                saving ||
                content === conflict.draftContent
              }
              onClick={() => void save(conflict.baseRevisionId)}
            >
              {t("chat.textArtifacts.saveMerged")}
            </Button>
          </div>
        )}
        <Space>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={loading || !filename.trim() || !content.trim()}
            onClick={() => void save()}
          >
            {selectedFile
              ? t("chat.textArtifacts.saveRevision")
              : t("chat.textArtifacts.create")}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
