import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Table,
  Typography,
} from "antd";
import { ehrApi, type SearchResult } from "@/api/modules/ehr";
import { useTranslation } from "react-i18next";

export default function DrugQueryView() {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ query: string }>();
  const [rows, setRows] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);

  const run = useCallback(async ({ query }: { query: string }) => {
    setLoading(true);
    setError(false);
    try {
      const response = await ehrApi.search(query.trim(), {
        type: "drug",
        top_k: 12,
      });
      setRows(response.results);
      setTotal(response.total);
      setSearched(true);
    } catch {
      setRows([]);
      setTotal(0);
      setSearched(false);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="ehr-drug-view">
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={run}>
          <Form.Item
            name="query"
            label={t("ehrWorkbenchPage.drugQueryLabel")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input
              placeholder={t("ehrWorkbenchPage.drugQueryPlaceholder")}
              style={{ width: 280 }}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              {t("ehrWorkbenchPage.searchButton")}
            </Button>
          </Form.Item>
          <Form.Item>
            <Button
              onClick={() => {
                form.resetFields();
                setRows([]);
                setTotal(0);
                setSearched(false);
                setError(false);
              }}
            >
              {t("ehrWorkbenchPage.resetButton")}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          message={t("ehrWorkbenchPage.drugQueryError")}
          style={{ marginBottom: 16 }}
        />
      )}

      {searched && (
        <Typography.Text
          type="secondary"
          style={{ display: "block", marginBottom: 8 }}
        >
          {t("ehrWorkbenchPage.drugQueryCount", { count: total })}
        </Typography.Text>
      )}
      {searched && rows.length === 0 ? (
        <Empty description={t("ehrWorkbenchPage.drugQueryEmpty")} />
      ) : (
        <Table<SearchResult>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 12, size: "small" }}
          columns={[
            {
              title: t("ehrWorkbenchPage.drugQueryResult"),
              dataIndex: "title",
              width: "32%",
            },
            {
              title: t("ehrWorkbenchPage.drugQueryDetail"),
              dataIndex: "snippet",
            },
          ]}
        />
      )}
      <Typography.Text type="secondary">
        {t("ehrWorkbenchPage.drugQueryDisclaimer")}
      </Typography.Text>
    </div>
  );
}
