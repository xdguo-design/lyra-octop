import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ehrApi, publicEhrApi, type SearchResult } from "@/api/modules/ehr";
import { TYPE_COLORS, TYPE_LABELS } from "./types";
import { ehrPlatformLoginUrl } from "./ehrPlatformLoginUrl";
import styles from "./index.module.less";

type SearchScope = "medical" | "documents" | "code" | "all";

// PRD 汇总入口指向 PD 站「PRD 中心」，静态部署在 119 服务器 nginx 的 /pd/ 子路径。
const PD_PRD_CENTER_URL = "https://119.3.216.103/pd/prd-center.html";

const MEDICAL_TYPES = [
  "drug",
  "clinic_item",
  "diagnosis",
  "knowledge",
  "frequency",
  "usage",
];

export default function SearchHome({
  publicMode = false,
}: {
  publicMode?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("medical");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  let loginUrl = "";
  try {
    loginUrl = ehrPlatformLoginUrl();
  } catch (err) {
    console.error("Invalid EHR console URL", err);
  }

  const runSearch = useCallback(
    async (q: string, searchScope: SearchScope) => {
      const text = q.trim();
      if (!text) return;
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const filter =
          searchScope === "medical"
            ? { types: MEDICAL_TYPES }
            : searchScope === "documents"
            ? { type: "doc" }
            : searchScope === "code"
            ? { type: "code" }
            : {};
        const resp = publicMode
          ? await publicEhrApi.search(text, 12)
          : await ehrApi.search(text, filter);
        setResults(resp.results);
        if (resp.rerank_status === "fallback") {
          setNotice(t("ehrWorkbenchPage.rerankFallback"));
        }
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [publicMode, t],
  );

  const scopeOptions = publicMode
    ? [{ label: t("ehrWorkbenchPage.scopeMedical"), value: "medical" }]
    : [
        { label: t("ehrWorkbenchPage.scopeAll"), value: "all" },
        { label: t("ehrWorkbenchPage.scopeMedical"), value: "medical" },
        { label: t("ehrWorkbenchPage.scopeDocuments"), value: "documents" },
        { label: t("ehrWorkbenchPage.scopeCode"), value: "code" },
      ];

  return (
    <div className={styles.ehrSearchHome}>
      {!searched && (
        <section
          className={styles.ehrSearchHero}
          aria-labelledby="ehr-search-title"
        >
          <Typography.Text className={styles.ehrEyebrow}>
            EHR KNOWLEDGE WORKSPACE
          </Typography.Text>
          <Typography.Title
            id="ehr-search-title"
            className={styles.ehrSearchTitle}
          >
            {t("ehrWorkbenchPage.homeTitle")}
          </Typography.Title>
          <Typography.Paragraph className={styles.ehrSearchDescription}>
            {t("ehrWorkbenchPage.searchDescription")}
          </Typography.Paragraph>
          <Input.Search
            className={styles.ehrSearchInput}
            size="large"
            allowClear
            loading={loading}
            prefix={<SearchOutlined />}
            placeholder={t("ehrWorkbenchPage.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={(value) => void runSearch(value, scope)}
            enterButton={t("ehrWorkbenchPage.searchButton")}
            addonBefore={
              <Select
                aria-label={t("ehrWorkbenchPage.searchScope")}
                bordered={false}
                value={scope}
                onChange={(value) => {
                  setScope(value);
                  if (query.trim()) void runSearch(query, value);
                }}
                options={scopeOptions}
                disabled={publicMode}
              />
            }
          />
          {!publicMode && (
            <nav
              className={styles.ehrSecondaryLinks}
              aria-label={t("ehrWorkbenchPage.moreEntries")}
            >
              <a href={PD_PRD_CENTER_URL} target="_blank" rel="noreferrer">
                {t("ehrWorkbenchPage.docsEntry")}
              </a>
              <Button
                type="primary"
                href={loginUrl || undefined}
                disabled={!loginUrl}
              >
                {t("ehrWorkbenchPage.hisLoginEntry")}
              </Button>
              <a
                href="https://github.com/xdguo-design/ehr-platform/tree/main"
                target="_blank"
                rel="noreferrer"
              >
                {t("ehrWorkbenchPage.codeEntry")}
              </a>
            </nav>
          )}
        </section>
      )}

      {searched && (
        <div className={styles.ehrSearchBar}>
          <Input.Search
            size="large"
            allowClear
            loading={loading}
            prefix={<SearchOutlined />}
            placeholder={t("ehrWorkbenchPage.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={(value) => void runSearch(value, scope)}
            enterButton={t("ehrWorkbenchPage.searchButton")}
            addonBefore={
              <Select
                aria-label={t("ehrWorkbenchPage.searchScope")}
                bordered={false}
                value={scope}
                onChange={(value) => {
                  setScope(value);
                  if (query.trim()) void runSearch(query, value);
                }}
                options={scopeOptions}
                disabled={publicMode}
              />
            }
          />
        </div>
      )}

      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      {notice && <Alert type="warning" showIcon message={notice} />}

      {loading && results.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <Empty description="没有找到相关内容，换个问法试试" />
      )}

      <div className={styles.ehrResultList}>
        {results.map((r) => (
          <Card
            key={r.id}
            size="small"
            className={styles.ehrResultCard}
            title={
              <Space wrap>
                <Tag color={TYPE_COLORS[r.type] || "default"}>
                  {TYPE_LABELS[r.type] || r.type}
                </Tag>
                <span>{r.title}</span>
              </Space>
            }
            extra={
              <Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("ehrWorkbenchPage.resultSource")}{" "}
                  {String(r.meta.path || r.meta.source || r.type)}
                </Typography.Text>
              </Space>
            }
          >
            <Typography.Paragraph
              ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
              style={{ marginBottom: 8, whiteSpace: "pre-wrap" }}
            >
              {r.snippet}
            </Typography.Paragraph>
            <Space wrap size={4}>
              {Object.entries(r.meta || {})
                .filter(
                  ([k, v]) =>
                    [
                      "category",
                      "department",
                      "item_type",
                      "manufacturer",
                      "insurance",
                      "form",
                      "flags",
                      "path",
                      "spec",
                    ].includes(k) &&
                    v !== "" &&
                    v !== null &&
                    v !== undefined &&
                    !(Array.isArray(v) && v.length === 0),
                )
                .map(([k, v]) => (
                  <Tag key={k} bordered={false}>
                    {k}: {Array.isArray(v) ? v.join("、") : String(v)}
                  </Tag>
                ))}
            </Space>
          </Card>
        ))}
      </div>
    </div>
  );
}
