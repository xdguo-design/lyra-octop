import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import PageShell from "../../layouts/PageShell";
import { creationsApi, type CreationItem } from "../../api/modules/creations";
import { BUILT_IN_CREATIONS } from "../Creations/builtInCreations";

// Card bodies vary in text length; the description takes the slack so every
// action button lands on the same baseline inside a grid row.
const cardDescriptionStyle = {
  margin: "0 0 16px",
  minHeight: 42,
  flex: 1,
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--fn-text-secondary)",
} as const;
const cardActionStyle = { alignSelf: "flex-start", marginTop: "auto" } as const;

export default function AppDirectoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<CreationItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    setLoading(true);
    void creationsApi
      .list()
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch(() => {
        if (active) {
          setItems([]);
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const query = keyword.trim().toLocaleLowerCase();
  const applications = BUILT_IN_CREATIONS.filter(
    (item) =>
      item.type === "app" &&
      item.route &&
      `${t(item.titleKey)} ${t(item.descriptionKey)}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const userItems = items.filter((item) =>
    `${item.name} ${item.description}`.toLocaleLowerCase().includes(query),
  );
  return (
    <PageShell
      title={t("appDirectoryPage.title")}
      subtitle={t("appDirectoryPage.subtitle")}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Input.Search
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("appDirectoryPage.search")}
            allowClear
            style={{ flex: "0 1 360px", minWidth: 0 }}
          />
          <Button onClick={() => navigate("/creations")}>
            {t("appDirectoryPage.manage")}
          </Button>
        </div>
        {error && (
          <Alert
            type="error"
            showIcon
            message={t("appDirectoryPage.loadFailed")}
            action={
              <Button
                size="small"
                onClick={() => setRefresh((value) => value + 1)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        )}
        {loading && <Spin />}
        {!loading &&
          !error &&
          applications.length === 0 &&
          userItems.length === 0 && (
            <Empty description={t("appDirectoryPage.empty")} />
          )}
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
          }}
        >
          {applications.map((app) =>
            app.type === "app" && app.route ? (
              <Card
                key={app.id}
                title={t(app.titleKey)}
                hoverable
                style={{ display: "flex", flexDirection: "column" }}
                styles={{
                  body: { display: "flex", flexDirection: "column", flex: 1 },
                }}
              >
                <p style={cardDescriptionStyle}>{t(app.descriptionKey)}</p>
                <Button
                  style={cardActionStyle}
                  onClick={() => navigate(app.route!)}
                >
                  {t("appDirectoryPage.open")}
                </Button>
              </Card>
            ) : null,
          )}
          {userItems.map((item) => (
            <Card
              key={item.item_id}
              title={item.name}
              hoverable
              style={{ display: "flex", flexDirection: "column" }}
              styles={{
                body: { display: "flex", flexDirection: "column", flex: 1 },
              }}
            >
              <p style={cardDescriptionStyle}>{item.description}</p>
              <Button
                style={cardActionStyle}
                onClick={() => navigate("/creations")}
              >
                {t("appDirectoryPage.manage")}
              </Button>
            </Card>
          ))}
        </div>
      </Space>
    </PageShell>
  );
}
