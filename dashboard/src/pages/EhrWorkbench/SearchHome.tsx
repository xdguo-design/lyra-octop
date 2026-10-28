import { useCallback, useState } from "react";
import {
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
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ehrApi, publicEhrApi, type SearchResult } from "@/api/modules/ehr";
import { TYPE_COLORS, TYPE_LABELS } from "./types";
import { ehrPlatformLoginUrl } from "./ehrPlatformLoginUrl";
import styles from "./index.module.less";

type SearchScope = "medical" | "documents" | "code" | "all";

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
  onOpenDrugQuery,
}: {
  publicMode?: boolean;
  onOpenDrugQuery?: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("medical");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const runSearch = useCallback(
    async (q: string, searchScope: SearchScope) => {
      const text = q.trim();
      if (!text) return;
      setLoading(true);
      setError("");
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
          : await ehrApi.search(text, { ...filter, top_k: 12 });
        setResults(resp.results);
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [publicMode],
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
              <Link to="/ehr/prd">{t("ehrWorkbenchPage.docsEntry")}</Link>
              <a href={ehrPlatformLoginUrl()}>
                {t("ehrWorkbenchPage.hisLoginEntry")}
              </a>
              <a
                href="https://github.com/xdguo-design/ehr-platform/tree/main"
                target="_blank"
                rel="noreferrer"
              >
                {t("ehrWorkbenchPage.codeEntry")}
              </a>
              <Button type="link" onClick={onOpenDrugQuery}>
                {t("ehrWorkbenchPage.drugEntry")}
              </Button>
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
