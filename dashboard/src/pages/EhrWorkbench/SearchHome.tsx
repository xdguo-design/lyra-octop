import { useCallback, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { ehrApi, type SearchResult } from "@/api/modules/ehr";
import { TYPE_COLORS, TYPE_LABELS } from "./types";

interface Props {
  /**  Agent 面板联动：把检索词转发给助手 */
  onAskAgent?: (question: string) => void;
}

const QUICK_QUESTIONS = [
  "阿司匹林的禁忌症",
  "高危药品有哪些",
  "血常规检查注意事项",
  "头孢菌素类药品",
];

export default function SearchHome({ onAskAgent }: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const runSearch = useCallback(async (q: string, t: string) => {
    const text = q.trim();
    if (!text) return;
    setLoading(true);
    setError("");
    try {
      const resp = await ehrApi.search(text, {
        type: t || undefined,
        top_k: 12,
      });
      setResults(resp.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="ehr-search-home">
      <div className="ehr-search-hero">
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          EHR 医疗知识检索
        </Typography.Title>
        <Typography.Text type="secondary">
          药品 · 诊疗项目 · 诊断 · 频次用法 · 项目文档与代码，混合语义 +
          关键词检索
        </Typography.Text>
        <div className="ehr-search-bar">
          <Input
            size="large"
            allowClear
            placeholder="输入药品、检查项目、诊断或问题，回车检索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={() => runSearch(query, type)}
            prefix={<SearchOutlined />}
          />
          <Segmented
            value={type || "all"}
            onChange={(v) => {
              const t = v === "all" ? "" : String(v);
              setType(t);
              if (query.trim()) runSearch(query, t);
            }}
            options={[
              { label: "全部", value: "all" },
              { label: "药品", value: "drug" },
              { label: "项目", value: "clinic_item" },
              { label: "诊断", value: "diagnosis" },
              { label: "文档", value: "doc" },
              { label: "代码", value: "code" },
            ]}
          />
          <Button
            type="primary"
            size="large"
            loading={loading}
            onClick={() => runSearch(query, type)}
          >
            检索
          </Button>
        </div>
        <Space wrap style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">试试：</Typography.Text>
          {QUICK_QUESTIONS.map((q) => (
            <Button
              key={q}
              size="small"
              type="link"
              onClick={() => {
                setQuery(q);
                runSearch(q, type);
              }}
            >
              {q}
            </Button>
          ))}
        </Space>
      </div>

      {error && <Typography.Text type="danger">{error}</Typography.Text>}

      {loading && results.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <Empty description="没有找到相关内容，换个问法试试" />
      )}

      <div className="ehr-result-list">
        {results.map((r) => (
          <Card
            key={r.id}
            size="small"
            className="ehr-result-card"
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
                  相关度 {(r.score * 100).toFixed(0)}%
                </Typography.Text>
                {onAskAgent && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => onAskAgent(`${r.title} 的详细信息`)}
                  >
                    问助手
                  </Button>
                )}
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
