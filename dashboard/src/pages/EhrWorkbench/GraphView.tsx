import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { ehrApi, type GraphEdge, type GraphNode } from "@/api/modules/ehr";
import { TYPE_COLORS, TYPE_LABELS } from "./types";

const NODE_COLORS: Record<string, string> = {
  drug: "#c41d7f",
  clinic_item: "#1677ff",
  diagnosis: "#722ed1",
  department: "#13c2c2",
  category: "#fa8c16",
  manufacturer: "#52c41a",
  form: "#faad14",
  insurance: "#eb2f96",
  usage: "#08979c",
  frequency: "#0050b3",
  organ: "#7cb305",
  method: "#d4380d",
  doc: "#8c8c8c",
  skill: "#389e0d",
  item_type: "#0958d9",
};

interface SimNode extends GraphNode {
  x: number;
  y: number;
  degree: number;
}

const WIDTH = 720;
const HEIGHT = 460;

/** 极简力导向布局：斥力 + 弹簧 + 向心，固定迭代次数 */
function layout(nodes: SimNode[], edges: GraphEdge[], iterations = 260): void {
  const n = nodes.length;
  if (n === 0) return;
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  nodes.forEach((nd, i) => {
    const angle = (i / n) * Math.PI * 2;
    nd.x = WIDTH / 2 + Math.cos(angle) * Math.min(WIDTH, HEIGHT) * 0.32;
    nd.y = HEIGHT / 2 + Math.sin(angle) * Math.min(WIDTH, HEIGHT) * 0.32;
  });
  for (let iter = 0; iter < iterations; iter += 1) {
    const cooling = 1 - iter / iterations;
    // 斥力
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 260) continue;
        const force = 1400 / (dist * dist);
        dx /= dist;
        dy /= dist;
        a.x += dx * force * cooling;
        a.y += dy * force * cooling;
        b.x -= dx * force * cooling;
        b.y -= dy * force * cooling;
      }
    }
    // 弹簧
    for (const e of edges) {
      const a = nodes[index.get(e.source) as number];
      const b = nodes[index.get(e.target) as number];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 90) * 0.02 * cooling;
      const ux = dx / dist;
      const uy = dy / dist;
      a.x += ux * force;
      a.y += uy * force;
      b.x -= ux * force;
      b.y -= uy * force;
    }
    // 向心
    for (const nd of nodes) {
      nd.x += (WIDTH / 2 - nd.x) * 0.012 * cooling;
      nd.y += (HEIGHT / 2 - nd.y) * 0.012 * cooling;
      nd.x = Math.max(40, Math.min(WIDTH - 40, nd.x));
      nd.y = Math.max(24, Math.min(HEIGHT - 24, nd.y));
    }
  }
}

interface Props {
  /** 图谱中点击节点 -> 问助手 */
  onAskAgent?: (question: string) => void;
}

export default function GraphView({ onAskAgent }: Props) {
  const [keyword, setKeyword] = useState("");
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [center, setCenter] = useState<SimNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<GraphNode | null>(null);
  const [neighbors, setNeighbors] = useState<
    { rel: string; direction: string; node: GraphNode }[]
  >([]);
  const simRef = useRef(false);

  const loadSubgraph = useCallback(async (nodeId: string) => {
    setLoading(true);
    setError("");
    try {
      const sub = await ehrApi.graphSubgraph(nodeId, 2);
      const degree = new Map<string, number>();
      sub.edges.forEach((e) => {
        degree.set(e.source, (degree.get(e.source) || 0) + 1);
        degree.set(e.target, (degree.get(e.target) || 0) + 1);
      });
      const simNodes: SimNode[] = sub.nodes.map((nd) => ({
        ...nd,
        x: 0,
        y: 0,
        degree: degree.get(nd.id) || 0,
      }));
      if (!simRef.current) {
        simRef.current = true;
      }
      layout(simNodes, sub.edges);
      setNodes(simNodes);
      setEdges(sub.edges);
      setCenter(simNodes.find((nd) => nd.id === nodeId) || simNodes[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const searchEntity = useCallback(async () => {
    const name = keyword.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const resp = await ehrApi.graphSearch(name);
      if (!resp.nodes.length) {
        setError(`图谱中未找到「${name}」`);
        setLoading(false);
        return;
      }
      await loadSubgraph(resp.nodes[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [keyword, loadSubgraph]);

  const openNode = useCallback(async (id: string) => {
    try {
      const detail = await ehrApi.graphNode(id);
      setDetail(detail);
      setNeighbors(detail.neighbors || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // 初始载入一个示例实体
    void (async () => {
      try {
        const resp = await ehrApi.graphSearch("阿司匹林");
        if (resp.nodes.length) await loadSubgraph(resp.nodes[0].id);
      } catch {
        /* 服务未就绪时静默 */
      }
    })();
  }, [loadSubgraph]);

  return (
    <div className="ehr-graph-view">
      <div className="ehr-graph-toolbar">
        <Input
          allowClear
          placeholder="搜索实体（药品 / 项目 / 诊断 / 科室…）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={searchEntity}
          style={{ maxWidth: 360 }}
          prefix={<SearchOutlined />}
        />
        <Button type="primary" loading={loading} onClick={searchEntity}>
          查询关系
        </Button>
        {center && (
          <Typography.Text type="secondary">
            当前中心：{center.name}（{nodes.length} 节点 / {edges.length} 关系）
          </Typography.Text>
        )}
      </div>
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      {loading && nodes.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      )}
      {!loading && nodes.length === 0 && !error && (
        <Empty description="图谱为空，请先构建索引" />
      )}
      {nodes.length > 0 && (
        <svg
          className="ehr-graph-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="知识图谱关系图"
        >
          {edges.map((e, i) => {
            const a = nodes.find((nd) => nd.id === e.source);
            const b = nodes.find((nd) => nd.id === e.target);
            if (!a || !b) return null;
            return (
              <line
                key={`${e.source}-${e.target}-${e.rel}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#d9d9d9"
                strokeWidth={1}
              />
            );
          })}
          {nodes.map((nd) => {
            const r = 8 + Math.min(nd.degree, 8) * 1.6;
            const color = NODE_COLORS[nd.type] || "#595959";
            const isCenter = center?.id === nd.id;
            return (
              <g
                key={nd.id}
                className="ehr-graph-node"
                onClick={() => openNode(nd.id)}
                onDoubleClick={() => loadSubgraph(nd.id)}
              >
                <circle
                  cx={nd.x}
                  cy={nd.y}
                  r={r}
                  fill={color}
                  fillOpacity={isCenter ? 0.95 : 0.75}
                  stroke={isCenter ? "#000" : "#fff"}
                  strokeWidth={isCenter ? 2 : 1}
                />
                <text
                  x={nd.x}
                  y={nd.y + r + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#262626"
                >
                  {nd.name.length > 10 ? `${nd.name.slice(0, 10)}…` : nd.name}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        单击查看详情，双击以该节点为中心展开子图。
      </Typography.Text>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        width={420}
        title={
          detail
            ? `${TYPE_LABELS[detail.type] || detail.type}：${detail.name}`
            : ""
        }
      >
        {detail && (
          <>
            <Descriptions
              size="small"
              column={1}
              bordered
              items={Object.entries(detail.props || {}).map(([k, v]) => ({
                key: k,
                label: k,
                children: Array.isArray(v)
                  ? v.join("、")
                  : typeof v === "object" && v !== null
                  ? JSON.stringify(v)
                  : String(v ?? "-"),
              }))}
            />
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              关系（{neighbors.length}）
            </Typography.Title>
            <List
              size="small"
              dataSource={neighbors}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="ask"
                      type="link"
                      size="small"
                      onClick={() =>
                        onAskAgent?.(
                          `${detail.name} 和 ${item.node.name} 有什么关系`,
                        )
                      }
                    >
                      问助手
                    </Button>,
                  ]}
                >
                  <Space>
                    <Tag color={TYPE_COLORS[item.node.type] || "default"}>
                      {TYPE_LABELS[item.node.type] || item.node.type}
                    </Tag>
                    <Tag bordered={false}>
                      {item.direction === "out" ? "→" : "←"} {item.rel}
                    </Tag>
                    {item.node.name}
                  </Space>
                </List.Item>
              )}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
