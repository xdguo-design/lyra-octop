import { useEffect, useState } from "react";
import { Alert, Button, Card, Spin, Statistic } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import PageShell from "../../../layouts/PageShell";
import {
  getSystemOverview,
  type SystemOverview,
} from "../../../api/modules/systemOverview";

const sections = [
  { key: "users", path: "/admin/users", label: "nav.adminUsers" },
  { key: "models", path: "/admin/models", label: "nav.models" },
  { key: "storage", path: "/admin/backend", label: "nav.adminStorage" },
  { key: "plugins", path: "/admin/plugins", label: "nav.adminPlugins" },
  { key: "security", path: "/admin/security", label: "nav.security" },
  { key: "audit", path: "/admin/audit-log", label: "nav.auditLog" },
  { key: "advanced", path: "/admin/advanced", label: "nav.adminAdvanced" },
];

export default function AdminOverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setOverview(null);
    setError(false);
    void getSystemOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  return (
    <PageShell
      title={t("adminOverviewPage.title")}
      subtitle={t("adminOverviewPage.subtitle")}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message={t("adminOverviewPage.loadFailed")}
          action={
            <Button
              size="small"
              onClick={() => setRefresh((value) => value + 1)}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : !overview ? (
        <Spin />
      ) : (
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
            marginBottom: 16,
          }}
        >
          <Card>
            <Statistic
              title={t("adminOverviewPage.database")}
              value={t(
                overview.db
                  ? "adminOverviewPage.bound"
                  : "adminOverviewPage.unbound",
              )}
            />
          </Card>
          <Card>
            <Statistic
              title={t("adminOverviewPage.users")}
              value={overview.users_loaded}
            />
          </Card>
          <Card>
            <Statistic
              title={t("adminOverviewPage.agents")}
              value={overview.agents_running}
            />
          </Card>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
        }}
      >
        {sections.map((section) => (
          <Card key={section.key} title={t(section.label)}>
            <Button onClick={() => navigate(section.path)}>
              {t("adminOverviewPage.open")}
            </Button>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
