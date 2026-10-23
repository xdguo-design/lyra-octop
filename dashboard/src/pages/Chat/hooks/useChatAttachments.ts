import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { uploadFile } from "../../../api/modules/upload";
import { deleteChatFileDraft } from "../../../api/modules/files";
import { agentAttachmentAccessUrl } from "../../../utils/toolMediaBlocks";
import type { ChatAttachment } from "./useChat";
import { message as antMessage } from "@/utils/antdMessage";
import { apiErrorMessage } from "../../../utils/apiError";

import { inferAttachmentKind } from "../utils/chatAttachments";
import {
  DESKTOP_FILE_DROP_EVENT,
  filesFromDesktopDrop,
  type DesktopFileDropDetail,
} from "../../../utils/desktopFileDrop";
import {
  dragHasFiles,
  filesFromSnapshot,
  MAX_CHAT_UPLOAD_FILES,
  snapshotDroppedEntries,
  type CollectedDrop,
} from "../utils/droppedFiles";
import { useServerUploadLimit } from "../../../hooks/useServerUploadLimit";

/** At most this many uploads run at once; the rest wait in the queue. */
export const MAX_CONCURRENT_UPLOADS = 3;

export type ChatUploadStatus = "pending" | "uploading" | "done" | "failed";

export interface ChatUploadItem {
  key: string;
  file: File;
  uploadAgentId: string;
  status: ChatUploadStatus;
  attachment?: ChatAttachment;
  error?: unknown;
}

let _uploadKeySeq = 0;
function nextUploadKey(): string {
  _uploadKeySeq += 1;
  return `upload-${_uploadKeySeq}`;
}

type UploadResult = { ok: true } | { ok: false; error: unknown };

async function runBounded<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function useChatAttachments(agentId: string | null | undefined) {
  const { t } = useTranslation();
  const { maxUploadBytes, maxUploadMb } = useServerUploadLimit();
  const [items, setItems] = useState<ChatUploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const agentIdRef = useRef(agentId);
  const removedUploadKeysRef = useRef(new Set<string>());

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  // Attachments belong to the agent they were uploaded for: switching agents
  // must not carry them (or in-flight completions) into the new agent.
  useEffect(() => {
    setItems((prev) => {
      for (const item of prev) {
        if (item.status === "pending" || item.status === "uploading") {
          removedUploadKeysRef.current.add(item.key);
        }
      }
      return [];
    });
  }, [agentId]);

  const attachments = useMemo(
    () =>
      items
        .filter(
          (item): item is ChatUploadItem & { attachment: ChatAttachment } =>
            Boolean(item.attachment),
        )
        .map((item) => item.attachment),
    [items],
  );
  const uploading = items.some(
    (item) => item.status === "pending" || item.status === "uploading",
  );

  const runUpload = useCallback(
    async (
      key: string,
      file: File,
      uploadAgentId: string,
    ): Promise<UploadResult> => {
      setItems((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, status: "uploading" } : item,
        ),
      );
      try {
        const res = await uploadFile(uploadAgentId, file);
        const workspacePath = res.path || res.workspace_path;
        const previewUrl =
          res.access_url ||
          res.url ||
          (workspacePath
            ? agentAttachmentAccessUrl(
                uploadAgentId,
                workspacePath,
                res.media_type,
              )
            : "");
        const attachment: ChatAttachment = {
          url: previewUrl,
          filename: res.filename,
          mediaType: res.media_type,
          workspacePath,
          fileId: res.file_id,
          revisionId: res.revision_id,
          kind: inferAttachmentKind(file, res.media_type),
        };
        if (
          agentIdRef.current !== uploadAgentId ||
          removedUploadKeysRef.current.has(key)
        ) {
          removedUploadKeysRef.current.delete(key);
          if (res.file_id) {
            void deleteChatFileDraft(uploadAgentId, res.file_id).catch(
              () => undefined,
            );
          }
          return { ok: true };
        }
        // A late completion must not resurrect an item removed mid-flight or
        // land in the list after the user switched agents.
        setItems((prev) =>
          agentIdRef.current !== uploadAgentId
            ? prev
            : prev.map((item) =>
                item.key === key
                  ? { ...item, status: "done", attachment, error: undefined }
                  : item,
              ),
        );
        return { ok: true };
      } catch (err: unknown) {
        removedUploadKeysRef.current.delete(key);
        setItems((prev) =>
          agentIdRef.current !== uploadAgentId
            ? prev
            : prev.map((item) =>
                item.key === key
                  ? { ...item, status: "failed", error: err }
                  : item,
              ),
        );
        return { ok: false, error: err };
      }
    },
    [],
  );

  const enqueue = useCallback(
    (files: File[]) => {
      if (!agentId) {
        antMessage.error(t("upload.failed", "Upload failed"));
        return;
      }
      const uploadAgentId = agentId;
      const fresh: ChatUploadItem[] = files.map((file) => ({
        key: nextUploadKey(),
        file,
        uploadAgentId,
        status: "pending",
      }));
      setItems((prev) => [...prev, ...fresh]);
      void runBounded(
        fresh.map(
          (item) => () => runUpload(item.key, item.file, uploadAgentId),
        ),
        MAX_CONCURRENT_UPLOADS,
      ).then((results) => {
        const failures = results.filter(
          (result): result is { ok: false; error: unknown } => !result.ok,
        );
        if (failures.length === 0) return;
        antMessage.error(
          apiErrorMessage(
            failures[0].error,
            failures.length > 1
              ? t("upload.someFailed", "{{count}} files failed to upload", {
                  count: failures.length,
                })
              : t("upload.failed", "Upload failed"),
            t,
          ),
        );
      });
    },
    [agentId, runUpload, t],
  );

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const capped =
        incoming.length > MAX_CHAT_UPLOAD_FILES
          ? incoming.slice(0, MAX_CHAT_UPLOAD_FILES)
          : incoming;
      if (incoming.length > MAX_CHAT_UPLOAD_FILES) {
        antMessage.warning(
          t(
            "upload.tooMany",
            "Only the first {{max}} files can be uploaded at once",
            { max: MAX_CHAT_UPLOAD_FILES },
          ),
        );
      }
      const fileArr = capped.filter((f) => {
        if (f.size > maxUploadBytes) {
          antMessage.error(
            t("upload.tooLarge", "File too large (max {{maxMb}}MB): {{name}}", {
              name: f.name,
              maxMb: maxUploadMb,
            }),
          );
          return false;
        }
        return true;
      });

      if (fileArr.length === 0) return;
      enqueue(fileArr);
    },
    [enqueue, maxUploadBytes, maxUploadMb, t],
  );

  const retryUpload = useCallback(
    (key: string) => {
      if (!agentId) return;
      const item = items.find((candidate) => candidate.key === key);
      if (!item || item.status !== "failed") return;
      void runUpload(key, item.file, agentId);
    },
    [agentId, items, runUpload],
  );

  const removeUpload = useCallback((key: string) => {
    const item = items.find((candidate) => candidate.key === key);
    if (!item) return;
    if (item.status === "done" && item.attachment?.fileId) {
      void deleteChatFileDraft(item.uploadAgentId, item.attachment.fileId).catch(
        () => undefined,
      );
    } else if (item.status === "pending" || item.status === "uploading") {
      removedUploadKeysRef.current.add(key);
    }
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, [items]);

  const removeAttachment = useCallback(
    (index: number) => {
      const target = attachments[index];
      if (!target) return;
      const key = items.find((item) => item.attachment === target)?.key;
      if (key) removeUpload(key);
    },
    [attachments, items, removeUpload],
  );

  const clearAttachments = useCallback(() => {
    for (const item of items) {
      if (item.status === "pending" || item.status === "uploading") {
        removedUploadKeysRef.current.add(item.key);
      }
    }
    setItems([]);
  }, [items]);

  const restoreAttachments = useCallback((next: ChatAttachment[]) => {
    const placeholder = new File([], "restored");
    setItems(
      next.map((attachment) => ({
        key: nextUploadKey(),
        file: placeholder,
        uploadAgentId: agentIdRef.current || "",
        status: "done" as const,
        attachment,
      })),
    );
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFolderSelect = useCallback(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.click();
  }, []);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void processFiles(e.target.files);
      }
      e.target.value = "";
    },
    [processFiles],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        void processFiles(pastedFiles);
      }
    },
    [processFiles],
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      const snapshot = snapshotDroppedEntries(e.dataTransfer);
      if (!snapshot.hadFileItems) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      return (async () => {
        let collected: CollectedDrop;
        try {
          collected = await filesFromSnapshot(snapshot);
        } catch {
          antMessage.error(t("upload.failed", "Upload failed"));
          return;
        }
        if (collected.truncated) {
          antMessage.warning(
            t(
              "upload.tooMany",
              "Only the first {{max}} files can be uploaded at once",
              { max: MAX_CHAT_UPLOAD_FILES },
            ),
          );
        }
        if (collected.files.length === 0) {
          antMessage.warning(t("upload.emptyDrop", "No files to upload"));
          return;
        }
        await processFiles(collected.files);
      })();
    },
    [processFiles, t],
  );

  useEffect(() => {
    const onDesktopDrop = (event: Event) => {
      const detail = (event as CustomEvent<DesktopFileDropDetail>).detail;
      setDragOver(false);
      void (async () => {
        if (detail?.truncated) {
          antMessage.warning(
            t(
              "upload.tooMany",
              "Only the first {{max}} files can be uploaded at once",
              { max: detail.max ?? 500 },
            ),
          );
        }
        try {
          const files = await filesFromDesktopDrop(detail);
          if (files.length === 0) {
            antMessage.warning(t("upload.emptyDrop", "No files to upload"));
            return;
          }
          await processFiles(files);
        } catch {
          antMessage.error(t("upload.failed", "Upload failed"));
        }
      })();
    };
    window.addEventListener(DESKTOP_FILE_DROP_EVENT, onDesktopDrop);
    return () =>
      window.removeEventListener(DESKTOP_FILE_DROP_EVENT, onDesktopDrop);
  }, [processFiles, t]);

  return {
    items,
    attachments,
    uploading,
    dragOver,
    fileInputRef,
    folderInputRef,
    processFiles,
    handleFileSelect,
    handleFolderSelect,
    handleFileChange,
    removeAttachment,
    removeUpload,
    retryUpload,
    clearAttachments,
    restoreAttachments,
    handlePaste,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
