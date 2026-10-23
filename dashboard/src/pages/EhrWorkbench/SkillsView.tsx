import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { ehrApi, type EhrSkill } from "@/api/modules/ehr";

/** 技能参数 schema -> 简易表单（string / integer / enum） */
function ParamField({
  name,
  schema,
}: {
  name: string;
  schema: Record<string, unknown>;
}) {
  const type = String(schema.type || "string");
  const desc = schema.description ? String(schema.description) : "";
  if (type === "integer") {
    return (
      <Form.Item
        key={name}
        name={name}
        label={name}
        tooltip={desc}
        initialValue={(schema.default as number) ?? undefined}
      >
        <InputNumber style={{ width: "100%" }} />
      </Form.Item>
    );
  }
  if (Array.isArray(schema.enum)) {
    return (
      <Form.Item key={name} name={name} label={name} tooltip={desc}>
        <select
          className="ant-select-selector"
          style={{ width: "100%", height: 32 }}
        >
          <option value="">（不选）</option>
          {(schema.enum as string[]).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Form.Item>
    );
  }
  return (
    <Form.Item key={name} name={name} label={name} tooltip={desc}>
      <Input.TextArea rows={2} placeholder={desc || name} />
    </Form.Item>
  );
}

function SkillCard({
  skill,
  onResult,
}: {
  skill: EhrSkill;
  onResult: (name: string, result: unknown) => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    const values = form.getFieldsValue();
    const args: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") args[k] = v;
    });
    setLoading(true);
    try {
      const result = await ehrApi.runSkill(skill.name, args);
      onResult(skill.name, result);
    } finally {
      setLoading(false);
    }
  }, [form, onResult, skill.name]);

  const props = (skill.parameters?.properties || {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = (skill.parameters?.required as string[]) || [];

  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag color="green">{skill.name}</Tag>
          <span>{skill.title}</span>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {skill.description}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={run}>
        <Row gutter={16}>
          {Object.entries(props).map(([pname, schema]) => (
            <Col key={pname} xs={24} md={12}>
              <ParamField name={pname} schema={schema} />
            </Col>
          ))}
        </Row>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            执行
          </Button>
          <Button onClick={() => form.resetFields()}>清空</Button>
          {required.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              必填：{required.join("、")}
            </Typography.Text>
          )}
        </Space>
      </Form>
    </Card>
  );
}

export default function SkillsView() {
  const [skills, setSkills] = useState<EhrSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void (async () => {
      try {
        const resp = await ehrApi.skills();
        setSkills(resp.skills);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onResult = useCallback((name: string, result: unknown) => {
    setResults((prev) => ({ ...prev, [name]: result }));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }
  if (error) {
    return <Alert type="error" message="技能加载失败" description={error} />;
  }
  if (skills.length === 0) {
    return <Empty description="EHR 服务未提供技能" />;
  }

  return (
    <div className="ehr-skills-view">
      <Typography.Paragraph type="secondary">
        以下技能由 EHR RAG 服务提供，可手动执行验证；平台 Agent
        绑定后可由对话自动调用。
      </Typography.Paragraph>
      <Row gutter={16}>
        <Col xs={24} xl={14}>
          {skills.map((skill) => (
            <SkillCard key={skill.name} skill={skill} onResult={onResult} />
          ))}
        </Col>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="执行结果"
            style={{ position: "sticky", top: 16 }}
          >
            {Object.keys(results).length === 0 ? (
              <Empty description="执行技能后在此查看结果" />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {Object.entries(results).map(([name, result]) => (
                  <div key={name}>
                    <Tag color="green">{name}</Tag>
                    <pre className="ehr-json-block">
                      {JSON.stringify(result, null, 2).slice(0, 4000)}
                    </pre>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
