import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  MessageSquareText,
  GraduationCap,
  Database,
  Timer,
  LayoutGrid,
  Cpu,
  Settings,
  Send,
  Plus,
  Zap,
  FileText,
  BarChart3,
  NotebookPen,
  Languages,
  ImagePlus,
  Code2,
} from "lucide-react";
import { request } from "../../api/request";
import {
  octopThreadsApi,
  type OctopThread,
} from "../../api/modules/octopThreads";
import "@fontsource/ma-shan-zheng";
import "@fontsource/zcool-kuaile";
import "./home-workbench.css";

interface MeUser {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
}

interface SimpleAgent {
  agent_id?: string;
  id?: string;
  name?: string;
}

const PLANET_URL = "http://127.0.0.1:8130/";

const NAV_ITEMS = [
  { path: "/chat", label: "对话 Bot", Icon: MessageSquareText },
  { path: "/experts", label: "Agent 智能体", Icon: GraduationCap },
  { path: "/knowledge-bases", label: "知识库", Icon: Database },
  { path: "/tasks", label: "自动化", Icon: Timer },
  { path: "/admin/plugins", label: "应用中心", Icon: LayoutGrid },
  { path: "/admin/models", label: "模型管理", Icon: Cpu },
  { path: "/personalization/skills", label: "系统设置", Icon: Settings },
];

const FEATURE_CARDS = [
  {
    key: "qa",
    title: "智能问答",
    lines: ["知识问答", "随问随答", "代码助手"],
    img: "/wb-assets/card-qa.png",
    path: "/chat",
  },
  {
    key: "agent",
    title: "Agent 智能体",
    lines: ["规划任务", "自动执行", "多工具协作"],
    img: "/wb-assets/card-agent.png",
    path: "/experts",
  },
  {
    key: "kb",
    title: "知识库",
    lines: ["阅读总结", "资料查询", "文档整理"],
    img: "/wb-assets/card-kb.png",
    path: "/knowledge-bases",
  },
  {
    key: "planet",
    title: "星球乐园",
    lines: ["乐乐的学习星球", "游戏化学练", "打开专属乐园"],
    img: "/wb-assets/card-planet.png",
    path: "",
  },
];

const QUICK_START = [
  { Icon: FileText, label: "写报告", prompt: "帮我写一份报告：" },
  { Icon: BarChart3, label: "分析数据", prompt: "帮我分析这份数据：" },
  { Icon: NotebookPen, label: "总结文档", prompt: "帮我总结这篇文档：" },
  { Icon: Languages, label: "翻译内容", prompt: "帮我把这段内容翻译成英文：" },
  { Icon: ImagePlus, label: "生成图片", prompt: "帮我生成一张图片：" },
  { Icon: Code2, label: "写代码", prompt: "帮我写一段代码：" },
];

function relativeTime(ts: number): string {
  if (!ts) return "";
  const t = ts < 1e12 ? ts * 1000 : ts;
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return d.format("HH:mm");
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "昨天";
  return d.format("MM-DD");
}

export default function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<MeUser | null>(null);
  const [threads, setThreads] = useState<OctopThread[]>([]);
  const [threadAgentId, setThreadAgentId] = useState("");
  const [input, setInput] = useState("");
  const [planetOpen, setPlanetOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    request<MeUser>("/auth/me")
      .then(setUser)
      .catch(() => {});
    request<SimpleAgent[]>("/agents")
      .then((agents) => {
        const first = agents.find((a) => a.agent_id || a.id);
        const id = String(first?.agent_id || first?.id || "");
        if (!id) return;
        setThreadAgentId(id);
        octopThreadsApi
          .list(id, 10)
          .then(setThreads)
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  const sendToChat = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    navigate("/chat", { state: { prefillInput: trimmed } });
  };

  const openCard = (path: string) => {
    if (path) navigate(path);
    else setPlanetOpen(true);
  };

  const focusInput = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const displayName = user?.display_name || user?.username || "朋友";
  const roleLabel =
    user?.role === "admin" ? "管理员" : user?.role === "user" ? "成员" : "";

  return (
    <div className="wb-root">
      {/* ============ 左栏：新建任务 + 导航 + 任务历史 ============ */}
      <aside className="wb-side">
        <button
          type="button"
          className="wb-logo"
          onClick={() => navigate("/home")}
          aria-label="回到首页"
        >
          <img src="/wb-assets/dino.png" alt="logo" className="wb-logo-img" />
          <span className="wb-logo-text">
            <span className="wb-logo-title">AI 工作台</span>
            <span className="wb-logo-tape">私有云 · NAS 部署</span>
          </span>
        </button>

        <button
          type="button"
          className="wb-newtask"
          onClick={() => navigate("/chat")}
        >
          <Plus size={17} strokeWidth={2.6} />
          新建任务
        </button>

        <nav className="wb-nav">
          {NAV_ITEMS.map(({ path, label, Icon }) => (
            <button
              key={path}
              type="button"
              className="wb-nav-item"
              onClick={() => navigate(path)}
            >
              <Icon size={17} strokeWidth={2.2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="wb-side-section">
          <span>任务</span>
          <button type="button" onClick={() => navigate("/chat")}>
            查看全部
          </button>
        </div>
        <div className="wb-task-list">
          {threads.length === 0 && (
            <div className="wb-task-empty">还没有任务，新建一个吧！</div>
          )}
          {threads.map((t) => (
            <button
              key={t.thread_id}
              type="button"
              className="wb-task-item"
              onClick={() =>
                threadAgentId
                  ? navigate(`/chat/${threadAgentId}/${t.thread_id}`)
                  : navigate("/chat")
              }
            >
              <span className="wb-task-title">
                {t.title || "未命名任务"}
              </span>
              <time>{relativeTime(t.last_active)}</time>
            </button>
          ))}
        </div>

        <div className="wb-user">
          <span className="wb-avatar">{displayName.slice(0, 1)}</span>
          <div className="wb-user-meta">
            <strong>{displayName}</strong>
            {roleLabel && <em>{roleLabel}</em>}
          </div>
        </div>
      </aside>

      {/* ============ 中央：居中 hero + 入口卡 + 底部大输入框 ============ */}
      <main className="wb-main">
        <div className="wb-scroll">
          <section className="wb-hero">
            <div className="wb-hero-brand">
              <img
                src="/wb-assets/dino.png"
                alt=""
                className="wb-hero-dino"
              />
              <h1>
                你的<span className="wb-hl">私有云</span>
                <span className="wb-hl wb-hl-blue">AI 工作台</span>
              </h1>
            </div>
            <p className="wb-hero-sub">
              把复杂的工作，交给家里的 AI Bot 处理！
            </p>
          </section>

          <div className="wb-cards">
            {FEATURE_CARDS.map((card, i) => (
              <button
                key={card.key}
                type="button"
                className={`wb-card wb-wobble wb-tilt-${i % 4}`}
                onClick={() => openCard(card.path)}
              >
                <img src={card.img} alt="" className="wb-card-img" />
                <div className="wb-card-body">
                  <strong>{card.title}</strong>
                  {card.lines.map((line) => (
                    <em key={line}>{line}</em>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <section className="wb-quick">
            <h2 className="wb-sec-title">
              <Zap size={17} strokeWidth={2.4} /> 快速开始
            </h2>
            <div className="wb-quick-row">
              {QUICK_START.map(({ Icon, label, prompt }) => (
                <button
                  key={label}
                  type="button"
                  className="wb-quick-item wb-wobble-sm"
                  onClick={() => {
                    setInput(prompt);
                    focusInput();
                  }}
                >
                  <Icon size={20} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="wb-ask wb-wobble">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="分配一个任务，或输入 / 查看更多…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendToChat(input);
              }
            }}
          />
          <div className="wb-ask-bar">
            <span className="wb-ask-hint">回车发送 · 将在对话 Bot 中打开</span>
            <button
              type="button"
              className="wb-send"
              aria-label="发送"
              onClick={() => sendToChat(input)}
            >
              <Send size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </main>

      {/* ============ 星球乐园弹层 ============ */}
      {planetOpen && (
        <div
          className="wb-planet-overlay"
          role="dialog"
          onClick={() => setPlanetOpen(false)}
        >
          <div
            className="wb-planet-window wb-wobble"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wb-planet-bar">
              <span>🌟 星球乐园 · 乐乐的学习星球</span>
              <button type="button" onClick={() => setPlanetOpen(false)}>
                关闭
              </button>
            </div>
            <iframe src={PLANET_URL} title="星球乐园" />
          </div>
        </div>
      )}
    </div>
  );
}
