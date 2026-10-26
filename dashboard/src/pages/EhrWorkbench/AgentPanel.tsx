import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { SendOutlined } from "@ant-design/icons";
import { ehrApi } from "@/api/modules/ehr";
import { TYPE_LABELS, type ChatMessage } from "./types";

const SUGGESTIONS = [
  "阿司匹林有哪些禁忌症？",
  "高危药品包括哪些？",
  "血常规检查需要注意什么？",
  "头孢菌素类有哪些药？",
];

let seq = 0;
function nextId(): string {
  seq += 1;
  return `msg-${seq}-${Date.now()}`;
}

export default function AgentPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || pending) return;
      const userMsg: ChatMessage = { id: nextId(), role: "user", text };
      const botMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      setInput("");
      setPending(true);
      try {
        const resp = await ehrApi.qa(text);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsg.id
              ? {
                  ...m,
                  text: resp.answer,
                  sources: resp.sources,
                  degraded: resp.degraded,
                  pending: false,
                }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsg.id
              ? {
                  ...m,
                  text: `请求失败：${
                    err instanceof Error ? err.message : String(err)
                  }`,
                  pending: false,
                }
              : m,
          ),
        );
      } finally {
        setPending(false);
        requestAnimationFrame(() => {
          listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
        });
      }
    },
    [pending],
  );

  // 其它视图（检索/图谱）通过 ehr:ask-agent 事件转来问题
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) void ask(detail);
    };
    window.addEventListener("ehr:ask-agent", handler);
    return () => window.removeEventListener("ehr:ask-agent", handler);
  }, [ask]);

  return (
    <div className="ehr-agent-panel">
      <div className="ehr-agent-header">
        <Space>
          <Avatar size={28} src="/lyra-dino.svg" />
          <div>
            <Typography.Text strong>EHR 知识助手</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              检索增强问答 · 可调用知识库与图谱技能
            </Typography.Text>
          </div>
        </Space>
      </div>

      <div className="ehr-agent-messages" ref={listRef}>
        {messages.length === 0 ? (
          <Empty
            description="向助手提问，或从下面开始"
            style={{ marginTop: 32 }}
          >
            <Space wrap>
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="small" onClick={() => ask(s)}>
                  {s}
                </Button>
              ))}
            </Space>
          </Empty>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ehr-msg ehr-msg-user">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="ehr-msg ehr-msg-bot">
                {m.pending ? (
                  <Spin size="small" />
                ) : (
                  <>
                    <Typography.Paragraph
                      style={{ whiteSpace: "pre-wrap", marginBottom: 4 }}
                    >
                      {m.text}
                    </Typography.Paragraph>
                    {m.sources && m.sources.length > 0 && (
                      <div className="ehr-msg-sources">
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          参考来源：
                        </Typography.Text>
                        <Space wrap size={4} style={{ marginTop: 2 }}>
                          {m.sources.map((s) => (
                            <Tag key={s.id} bordered={false}>
                              [{TYPE_LABELS[s.type] || s.type}] {s.title}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {m.degraded && (
                      <Typography.Text type="warning" style={{ fontSize: 12 }}>
                        未配置 LLM，当前为纯检索结果
                      </Typography.Text>
                    )}
                  </>
                )}
              </div>
            ),
          )
        )}
      </div>

      <div className="ehr-agent-input">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          placeholder="Enter 发送，Shift+Enter 换行"
          autoSize={{ minRows: 1, maxRows: 4 }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={pending}
          onClick={() => ask(input)}
        >
          发送
        </Button>
      </div>
    </div>
  );
}
