import { useTranslation } from "react-i18next";
import AuditLogPanel from "../../Settings/Security/AuditLogPanel";
import PageShell from "../../../layouts/PageShell";

export default function AdminAuditLogPage() {
  const { t } = useTranslation();
  return (
    <PageShell
      title={t("adminAudit.pageTitle")}
      subtitle={t("adminAudit.pageSubtitle")}
    >
      <AuditLogPanel />
    </PageShell>
  );
}
