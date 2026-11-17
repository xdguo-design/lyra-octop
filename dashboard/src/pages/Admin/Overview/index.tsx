import { useEffect, useState } from "react";
import { Alert, Button, Card, Spin } from "antd";
import {
  ChevronRight,
  Cpu,
  HardDrive,
  Puzzle,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import PageShell from "../../../layouts/PageShell";
import {
  getSystemOverview,
  type SystemOverview,
} from "../../../api/modules/systemOverview";

const sections = [
  { key: "users", path: "/admin/users", label: "nav.adminUsers", Icon: Users },
  { key: "models", path: "/admin/models", label: "nav.models", Icon: Cpu },
  {
    key: "storage",
    path: "/admin/backend",
    label: "nav.adminStorage",
    Icon: HardDrive,
  },
  {
    key: "plugins",
    path: "/admin/plugins",
    label: "nav.adminPlugins",
    Icon: Puzzle,
  },
  {
    key: "security",
    path: "/admin/security",
    label: "nav.security",
    Icon: ShieldCheck,
  },
  {
    key: "audit",
    path: "/admin/audit-log",
    label: "nav.auditLog",
    Icon: ScrollText,
  },
  {
    key: "advanced",
    path: "/admin/advanced",
    label: "nav.adminAdvanced",
    Icon: SlidersHorizontal,
  },
];

// Shared type scale for the status tiles and the section tiles.
const statLabelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fn-text-tertiary)",
};
const statValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  fontWeight: 650,
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
  fontVariantNumeric: "tabular-nums",
  color: "var(--fn-text-primary)",
};

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
          {[
            {
              key: "db",
              label: t("adminOverviewPage.database"),
              value: t(
                overview.db
                  ? "adminOverviewPage.bound"
                  : "adminOverviewPage.unbound",
              ),
            },
            {
              key: "users",
              label: t("adminOverviewPage.users"),
              value: overview.users_loaded,
            },
            {
              key: "agents",
              label: t("adminOverviewPage.agents"),
              value: overview.agents_running,
            },
          ].map((stat) => (
            <Card key={stat.key} styles={{ body: { padding: "16px 18px" } }}>
              <div style={statLabelStyle}>{stat.label}</div>
              <div style={statValueStyle}>{stat.value}</div>
            </Card>
          ))}
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
          <Card
            key={section.key}
            hoverable
            styles={{ body: { padding: "12px 8px 12px 14px" } }}
            onClick={() => navigate(section.path)}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
              }}
            >
              <section.Icon
                size={16}
                style={{ color: "var(--fn-text-tertiary)", flexShrink: 0 }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13.5,
                  fontWeight: 550,
                  color: "var(--fn-text-primary)",
                }}
              >
                {t(section.label)}
              </span>
              <Button
                type="text"
                size="small"
                aria-label={`${t("adminOverviewPage.open")} ${t(
                  section.label,
                )}`}
                icon={<ChevronRight size={16} />}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(section.path);
                }}
              />
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
