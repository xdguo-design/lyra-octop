import { useCallback, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Form,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ehrApi } from "@/api/modules/ehr";

interface DrugRow {
  id: string;
  title: string;
  category?: string;
  manufacturer?: string;
  insurance?: string;
  spec?: string;
  flags?: string[];
}

const INSURANCE_OPTIONS = [
  { label: "甲类", value: "甲类" },
  { label: "乙类", value: "乙类" },
  { label: "自费", value: "自费" },
];

const FLAG_OPTIONS = [
  { label: "高危药品", value: "高危药品" },
  { label: "抗肿瘤药", value: "抗肿瘤药" },
  { label: "需皮试", value: "需皮试" },
  { label: "抗菌药物", value: "抗菌药物" },
  { label: "血液制品", value: "血液制品" },
  { label: "贵重药品", value: "贵重药品" },
];

const FLAG_COLORS: Record<string, string> = {
  高危药品: "red",
  抗肿瘤药: "volcano",
  需皮试: "orange",
  抗菌药物: "gold",
  血液制品: "magenta",
  贵重药品: "purple",
};

export default function DrugQueryView() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<DrugRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = useCallback(async () => {
    const values = form.getFieldsValue();
    setLoading(true);
    try {
      const resp = (await ehrApi.runSkill("ehr_drug", {
        name: values.name || undefined,
        category: values.category || undefined,
        manufacturer: values.manufacturer || undefined,
        insurance: values.insurance || undefined,
        flag: values.flag || undefined,
        limit: 100,
      })) as { total: number; results: DrugRow[]; error?: string };
      setRows(resp.results || []);
      setTotal(resp.total || 0);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [form]);

  return (
    <div className="ehr-drug-view">
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={run}>
          <Form.Item name="name" label="名称">
            <input
              className="ant-input"
              placeholder="如：阿司匹林"
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <input
              className="ant-input"
              placeholder="如：头孢菌素类"
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item name="manufacturer" label="厂家">
            <input
              className="ant-input"
              placeholder="如：拜耳"
              style={{ width: 140 }}
            />
          </Form.Item>
          <Form.Item name="insurance" label="医保">
            <Select
              allowClear
              placeholder="全部"
              options={INSURANCE_OPTIONS}
              style={{ width: 110 }}
            />
          </Form.Item>
          <Form.Item name="flag" label="警示">
            <Select
              allowClear
              placeholder="全部"
              options={FLAG_OPTIONS}
              style={{ width: 130 }}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                查询
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setRows([]);
                  setSearched(false);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {searched && (
        <Typography.Text
          type="secondary"
          style={{ marginBottom: 8, display: "block" }}
        >
          共 {total} 条（最多展示 100 条）
        </Typography.Text>
      )}
      {searched && rows.length === 0 ? (
        <Empty description="没有符合条件的药品" />
      ) : (
        <Table<DrugRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 15, size: "small" }}
          columns={[
            { title: "药品", dataIndex: "title", ellipsis: true },
            {
              title: "分类",
              dataIndex: "category",
              ellipsis: true,
              render: (v: string) => v || "-",
            },
            {
              title: "规格",
              dataIndex: "spec",
              width: 100,
              render: (v: string) => v || "-",
            },
            {
              title: "厂家",
              dataIndex: "manufacturer",
              ellipsis: true,
              render: (v: string) => v || "-",
            },
            {
              title: "医保",
              dataIndex: "insurance",
              width: 80,
              render: (v: string) => v || "-",
            },
            {
              title: "警示",
              dataIndex: "flags",
              render: (flags: string[]) =>
                flags && flags.length ? (
                  <Space size={2} wrap>
                    {flags.map((f) => (
                      <Tag key={f} color={FLAG_COLORS[f] || "default"}>
                        {f}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  "-"
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
