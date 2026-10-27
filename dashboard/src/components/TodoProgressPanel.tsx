import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  countCompletedTodos,
  type TodoListItem,
} from "../utils/parseWriteTodos";
import styles from "./TodoProgressPanel.module.less";

function statusIcon(status: TodoListItem["status"], isStreaming: boolean) {
  if (status === "in_progress" && isStreaming) {
    return <Loader2 size={16} className={styles.todoStatusInProgressSpin} />;
  }
  switch (status) {
    case "completed":
      return <CheckCircle2 size={16} className={styles.todoStatusCompleted} />;
    case "in_progress":
      return <CircleDot size={16} className={styles.todoStatusInProgress} />;
    case "cancelled":
      return <XCircle size={16} className={styles.todoStatusCancelled} />;
    default:
      return <Circle size={16} className={styles.todoStatusPending} />;
  }
}

export function TodoListView({
  items,
  isStreaming = false,
  className,
  variant = "inline",
}: {
  items: readonly TodoListItem[];
  isStreaming?: boolean;
  className?: string;
  variant?: "inline" | "panel";
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  const completed = countCompletedTodos(items);

  return (
    <div
      className={[
        styles.todoListBlock,
        variant === "panel" ? styles.todoProgressPanel : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.todoListHeader}>
        <div className={styles.todoListTitle}>
          {t("chatUsage.todoListTitle", "Task progress")}
        </div>
        <div className={styles.todoListSummary}>
          {t("chatUsage.todoListSummary", {
            completed,
            total: items.length,
            defaultValue: "{{completed}}/{{total}} done",
          })}
        </div>
      </div>
      <ul className={styles.todoListItems}>
        {items.map((item) => (
          <li key={item.id} className={styles.todoListItem}>
            <span className={styles.todoListIcon}>
              {statusIcon(item.status, isStreaming)}
            </span>
            <span
              className={`${styles.todoListText} ${
                item.status === "completed"
                  ? styles.todoListTextCompleted
                  : item.status === "cancelled"
                  ? styles.todoListTextCancelled
                  : ""
              }`}
            >
              {item.content}
            </span>
            <span className={styles.todoListStatus}>
              {t(`chatUsage.todoStatus.${item.status}`, item.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TodoProgressPanel({
  items,
  isStreaming = false,
  followingProcessSummary = false,
  onSyncTodos,
  isAgentBusy = false,
}: {
  items: readonly TodoListItem[];
  isStreaming?: boolean;
  followingProcessSummary?: boolean;
  onSyncTodos?: (items: readonly TodoListItem[]) => void;
  isAgentBusy?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<TodoListItem[]>(() => [...items]);

  useEffect(() => {
    if (!editing) setDraftItems([...items]);
  }, [items, editing]);

  const updateItem = (id: string, patch: Partial<TodoListItem>) => {
    setDraftItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const handleAdd = () => {
    setDraftItems((current) => [
      ...current,
      { id: "draft-" + Date.now() + "-" + current.length, content: "", status: "pending" },
    ]);
  };

  const handleRemove = (id: string) => {
    setDraftItems((current) => current.filter((item) => item.id !== id));
  };

  const handleMove = (index: number, offset: -1 | 1) => {
    setDraftItems((current) => {
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const handleCancel = () => {
    setDraftItems([...items]);
    setEditing(false);
  };

  const handleSync = () => {
    if (!onSyncTodos || isAgentBusy) return;
    const cleaned = draftItems
      .filter((item) => item.content.trim())
      .map((item, index) => ({
        ...item,
        id: String(index + 1),
        content: item.content.trim(),
      }));
    if (cleaned.length === 0) return;
    onSyncTodos(cleaned);
    setEditing(false);
  };

  const visibleItems = editing ? draftItems : items;
  const completed = countCompletedTodos(visibleItems);
  const containerClassName = [
    styles.todoListBlock,
    styles.todoProgressPanel,
    followingProcessSummary ? styles.followingProcessSummary : null,
  ].filter(Boolean).join(" ");

  return (
    <div className={containerClassName}>
      <div className={styles.todoListHeader}>
        <div className={styles.todoListTitle}>
          {t("chatUsage.todoListTitle", "任务进度")}
        </div>
        <div className={styles.todoHeaderActions}>
          <div className={styles.todoListSummary}>
            {t("chatUsage.todoListSummary", {
              completed,
              total: visibleItems.length,
              defaultValue: "已完成 {{completed}}/{{total}}",
            })}
          </div>
          {!editing && onSyncTodos ? (
            <button type="button" className={styles.todoActionButton} onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" />
              {t("chatUsage.todoEdit", "编辑任务")}
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <>
          <ul className={styles.todoEditorItems}>
            {draftItems.map((item, index) => (
              <li key={item.id} className={styles.todoEditorItem}>
                <select
                  className={styles.todoStatusSelect}
                  aria-label={t("chatUsage.todoStatusLabel", {
                    number: index + 1,
                    defaultValue: "第{{number}}项状态",
                  })}
                  value={item.status}
                  onChange={(event) => updateItem(item.id, { status: event.currentTarget.value })}
                >
                  <option value="pending">{t("chatUsage.todoStatus.pending", "待处理")}</option>
                  <option value="in_progress">{t("chatUsage.todoStatus.in_progress", "进行中")}</option>
                  <option value="completed">{t("chatUsage.todoStatus.completed", "已完成")}</option>
                  <option value="cancelled">{t("chatUsage.todoStatus.cancelled", "已取消")}</option>
                </select>
                <input
                  className={styles.todoContentInput}
                  aria-label={t("chatUsage.todoContentLabel", {
                    number: index + 1,
                    defaultValue: "第{{number}}项任务",
                  })}
                  placeholder={t("chatUsage.todoContentPlaceholder", "输入任务内容")}
                  value={item.content}
                  onChange={(event) => updateItem(item.id, { content: event.currentTarget.value })}
                />
                <button
                  type="button"
                  className={styles.todoMoveButton}
                  aria-label={t("chatUsage.todoMoveUp", {
                    number: index + 1,
                    defaultValue: "上移第{{number}}项",
                  })}
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.todoMoveButton}
                  aria-label={t("chatUsage.todoMoveDown", {
                    number: index + 1,
                    defaultValue: "下移第{{number}}项",
                  })}
                  disabled={index === draftItems.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.todoRemoveButton}
                  aria-label={t("chatUsage.todoRemove", "删除任务")}
                  onClick={() => handleRemove(item.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.todoEditorFooter}>
            <button type="button" className={styles.todoActionButton} onClick={handleAdd}>
              <Plus size={14} aria-hidden="true" />
              {t("chatUsage.todoAdd", "添加任务")}
            </button>
            <div className={styles.todoEditorActions}>
              <button type="button" className={styles.todoActionButton} onClick={handleCancel}>
                <X size={14} aria-hidden="true" />
                {t("chatUsage.todoCancel", "取消")}
              </button>
              <button
                type="button"
                className={styles.todoSyncButton}
                disabled={isAgentBusy || !draftItems.some((item) => item.content.trim().length > 0)}
                onClick={handleSync}
              >
                <Send size={14} aria-hidden="true" />
                {isAgentBusy
                  ? t("chatUsage.todoSyncBusy", "Agent 执行中")
                  : t("chatUsage.todoSync", "同步给 Agent")}
              </button>
            </div>
          </div>
          {isAgentBusy ? (
            <div className={styles.todoSyncHint}>
              {t("chatUsage.todoSyncHint", "Agent 执行中仍可编辑；完成后再同步。")}
            </div>
          ) : null}
        </>
      ) : (
        <ul className={styles.todoListItems}>
          {items.map((item) => (
            <li key={item.id} className={styles.todoListItem}>
              <span className={styles.todoListIcon}>{statusIcon(item.status, isStreaming)}</span>
              <span
                className={
                  styles.todoListText +
                  (item.status === "completed"
                    ? " " + styles.todoListTextCompleted
                    : item.status === "cancelled"
                      ? " " + styles.todoListTextCancelled
                      : "")
                }
              >
                {item.content}
              </span>
              <span className={styles.todoListStatus}>
                {t("chatUsage.todoStatus." + item.status, item.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
