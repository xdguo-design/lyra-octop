import { Tag, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { KnowledgeDocument } from "../../api/modules/knowledgeBases";

interface DocumentStatusTagProps {
  status: KnowledgeDocument["status"];
  errorMessage?: string | null;
  className?: string;
}

function statusColor(status: KnowledgeDocument["status"]) {
  if (status === "ready") return "success";
  if (status === "failed") return "error";
  if (status === "processing") return "processing";
  return "default";
}

export default function DocumentStatusTag({
  status,
  errorMessage,
  className,
}: DocumentStatusTagProps) {
  const { t } = useTranslation();

  return (
    <Tooltip title={errorMessage || t(`knowledgeBases.statuses.${status}`)}>
      <Tag className={className} color={statusColor(status)}>
        {t(`knowledgeBases.statusesShort.${status}`)}
      </Tag>
    </Tooltip>
  );
}
