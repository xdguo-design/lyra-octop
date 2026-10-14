import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dayjs from "dayjs";
import {
  ArrowLeft, ArrowRight, Bot, Boxes, ChevronRight, CircleHelp,
  Cpu, Database, ExternalLink, GraduationCap, Home, Layers3,
  LayoutGrid, Maximize2, MessageCircle, MessageSquareText, Plus,
  Send, Settings2, ShieldCheck, Sparkles, Square, Timer, Users,
  Workflow, Wrench, X,
} from "lucide-react";
import { request } from "../../api/request";
import { octopThreadsApi, type OctopThread } from "../../api/modules/octopThreads";
import { useChat } from "../Chat/hooks/useChat";
import type { OctopAgent } from "../../context/AgentContext";
import {
  canDelegate, resolvePrivatePlatformUrl, selectPrimaryAgent,
  visibleConversationMessages,
} from "./workbench-model";
import "./home-workbench.css";

interface MeUser {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
}

const NAV_ITEMS = [
  { path: "/home", label: "工作台", Icon: Home },
  { path: "/experts", label: "Agent 团队", Icon: Users },
  { path: "/knowledge-bases", label: "知识与文件", Icon: Database },
  { path: "/tasks", label: "自动化任务", Icon: Timer },
  { path: "/admin/plugins", label: "插件与工具", Icon: Boxes },
  { path: "/admin/models", label: "模型与算力", Icon: Cpu },
  { path: "/personalization/skills", label: "设置", Icon: Settings2 },
];

const PROMPTS = [
  { title: "帮我分析资料", text: "请作为主 Agent，规划并协调合适的 Agent 分析这份资料：" },
  { title: "创建一个项目", text: "请帮我规划一个新项目，拆分任务并分配给合适的 Agent：" },
  { title: "整理工作总结", text: "请汇总今天的工作，并生成一份可以执行的后续计划：" },
];

function formatTime(value: number) {
  if (!value) return "";
  const d = dayjs(value < 1e12 ? value * 1000 : value);
  return d.isSame(dayjs(), "day") ? d.format("HH:mm") : d.format("MM/DD");
}

function initialPlatformUrl() {
  const configured = import.meta.env.VITE_LYRA_PLANET_URL as string | undefined;
  const guessed = window.location.protocol + "//" + window.location.hostname + ":8130/";
  try {
    return window.localStorage.getItem("octop:workbench:planet-url") || configured || guessed;
  } catch {
    return configured || guessed;
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<MeUser | null>(null);
  const [agents, setAgents] = useState<OctopAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [threads, setThreads] = useState<OctopThread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [platformOpen, setPlatformOpen] = useState(false);
  const [platformSettingsOpen, setPlatformSettingsOpen] = useState(false);
  const [platformUrl, setPlatformUrl] = useState(initialPlatformUrl);
  const [platformDraft, setPlatformDraft] = useState(initialPlatformUrl);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const primary = useMemo(() => selectPrimaryAgent(agents), [agents]);
  const agentId = primary?.agent_id || null;
  const teamReady = canDelegate(primary);
  const {
    messages, isStreaming, historyLoading, historyError,
    sendMessage, cancelStream, loadHistory,
  } = useChat(activeThread, agentId, primary?.kind === "team");
  const visibleMessages = useMemo(
    () => visibleConversationMessages(messages, agentId),
    [messages, agentId],
  );
  const hasPendingApproval = messages.some(
    (m) => m.hitlData?.status === "pending",
  );
  const platformSrc = useMemo(
    () => resolvePrivatePlatformUrl(platformUrl, window.location.hostname),
    [platformUrl],
  );

  useEffect(() => {
    let cancelled = false;
    void request<MeUser>("/auth/me").then((value) => {
      if (!cancelled) setUser(value);
    }).catch(() => {});
    void request<OctopAgent[]>("/agents").then((value) => {
      if (!cancelled) setAgents(value);
    }).catch(() => {
      if (!cancelled) setError("无法加载 Agent 列表，请检查私有云服务。");
    }).finally(() => {
      if (!cancelled) setAgentsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setThreads([]);
    setActiveThread(null);
    if (!agentId) return;
    let cancelled = false;
    void octopThreadsApi.list(agentId, 30).then((rows) => {
      if (!cancelled) setThreads(rows);
    }).catch(() => {
      if (!cancelled) setError("暂时无法获取会话历史。");
    });
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    if (activeThread && agentId) void loadHistory(activeThread);
  }, [activeThread, agentId, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, messages, isStreaming]);

  const newTask = () => {
    setPlatformOpen(false);
    setActiveThread(null);
    setInput("");
    setError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectThread = (threadId: string) => {
    setPlatformOpen(false);
    setError("");
    setActiveThread(threadId);
  };

  const send = async (provided?: string) => {
    const text = (provided ?? input).trim();
    if (!text || !agentId || sending || isStreaming || hasPendingApproval) return;
    setSending(true);
    setError("");
    try {
      let threadId = activeThread;
      let sessionKey = threadId || "";
      if (!threadId) {
        const created = await octopThreadsApi.create(agentId);
        threadId = created.thread_id;
        sessionKey = created.session_key;
        const now = Math.floor(Date.now() / 1000);
        setThreads((prev) => [{
          thread_id: created.thread_id,
          session_key: created.session_key,
          channel_type: "dashboard",
          title: text.slice(0, 50),
          last_active: now,
          created_at: now,
        }, ...prev]);
        setActiveThread(threadId);
      }
      if (!threadId) throw new Error("无法创建会话");
      // The existing Octop WebSocket store handles streaming and reconnection.
      // Do not dispatch worker messages directly from this surface.
      sendMessage(text, sessionKey, agentId, undefined, threadId);
      setInput("");
      setThreads((prev) => prev.map((t) =>
        t.thread_id === threadId
          ? { ...t, title: t.title || text.slice(0, 50), last_active: Math.floor(Date.now() / 1000) }
          : t,
      ));
    } catch {
      setError("发送失败。请检查主 Agent 的运行状态，再重试。");
    } finally {
      setSending(false);
    }
  };

  const savePlatformUrl = () => {
    const next = resolvePrivatePlatformUrl(platformDraft, window.location.hostname);
    if (!next) {
      setError("平台地址只能使用当前私有云主机的 HTTP/HTTPS 地址，且不能包含账号密码。");
      return;
    }
    setPlatformUrl(next);
    try { window.localStorage.setItem("octop:workbench:planet-url", next); } catch { /* storage optional */ }
    setError("");
    setPlatformSettingsOpen(false);
  };

  const openPlatform = () => {
    setError("");
    setPlatformOpen(true);
    setPlatformSettingsOpen(false);
  };

  const displayName = user?.display_name || user?.username || "用户";
  const chatHref = agentId
    ? "/chat/" + encodeURIComponent(agentId) + (activeThread ? "/" + encodeURIComponent(activeThread) : "")
    : "/chat";
  const hasChat = activeThread !== null;

  return (
    <div className={"wb-root" + (platformOpen ? " wb-root-platform" : "")}>
      {!platformOpen && (
        <aside className="wb-side">
          <button className="wb-brand" type="button" onClick={newTask} aria-label="返回工作台">
            <span className="wb-brand-mark"><Bot size={26} strokeWidth={2.25} /></span>
            <span className="wb-brand-copy"><strong>LYRA <i>cloud</i></strong><small>PRIVATE AGENT SPACE</small></span>
          </button>
          <button className="wb-newtask" type="button" onClick={newTask}>
            <Plus size={18} /> 新建对话 <span className="wb-newtask-shortcut">+</span>
          </button>
          <nav className="wb-nav" aria-label="主导航">
            {NAV_ITEMS.map(({ path, label, Icon }) => (
              <button type="button" key={path}
                className={"wb-nav-item" + (path === "/home" ? " is-active" : "")}
                onClick={() => path === "/home" ? newTask() : navigate(path)}>
                <Icon size={17} /> <span>{label}</span>
                {path === "/home" && <span className="wb-active-dot" />}
              </button>
            ))}
            <button className="wb-nav-item" type="button" onClick={openPlatform}>
              <LayoutGrid size={17} /><span>内置平台</span><ChevronRight size={15} className="wb-nav-chevron" />
            </button>
          </nav>
          <div className="wb-sidebar-section"><strong>最近对话</strong><span>{threads.length}</span></div>
          <div className="wb-task-list" aria-label="会话历史">
            {threads.length === 0 && <p className="wb-task-empty">还没有对话，开始和主 Agent 交流吧。</p>}
            {threads.map((thread) => (
              <button key={thread.thread_id} type="button"
                onClick={() => selectThread(thread.thread_id)}
                className={"wb-task-item" + (activeThread === thread.thread_id ? " is-current" : "")}>
                <MessageSquareText size={15} />
                <span>{thread.title || "新的对话"}</span>
                <time>{formatTime(thread.last_active)}</time>
              </button>
            ))}
          </div>
          <div className="wb-sidebar-footer">
            <span className="wb-private-dot" />
            <span>私有部署</span><ShieldCheck size={15} /><span className="wb-footer-space" />
            <span className="wb-user-avatar">{displayName.slice(0, 1)}</span>
          </div>
        </aside>
      )}

      {platformOpen ? (
        <main className="wb-platform-shell">
          <div className="wb-platform-bar">
            <button type="button" className="wb-platform-back" onClick={() => setPlatformOpen(false)}>
              <ArrowLeft size={18} /> 返回工作台
            </button>
            <div className="wb-platform-title"><span className="wb-platform-icon"><Layers3 size={18} /></span>
              <strong>星球乐园</strong><small>内置平台 · 独立 Agent / LLM</small>
            </div>
            <div className="wb-platform-actions">
              <button type="button" onClick={() => setPlatformSettingsOpen((v) => !v)} aria-label="平台地址设置">
                <Settings2 size={17} />
              </button>
              <button type="button" onClick={() => {
                const el = document.querySelector(".wb-platform-shell");
                if (el instanceof HTMLElement && el.requestFullscreen) void el.requestFullscreen();
              }} aria-label="全屏显示平台"><Maximize2 size={17} /></button>
              <button type="button" onClick={() => setPlatformOpen(false)} aria-label="关闭平台"><X size={18} /></button>
            </div>
          </div>
          {platformSettingsOpen && (
            <form className="wb-platform-settings" onSubmit={(e) => { e.preventDefault(); savePlatformUrl(); }}>
              <label htmlFor="wb-platform-url">平台访问地址（同一私有云主机，支持独立端口）</label>
              <div><input id="wb-platform-url" value={platformDraft}
                onChange={(e) => setPlatformDraft(e.target.value)} type="url" autoComplete="url" />
                <button type="submit">保存并打开</button></div>
              <p>内置平台使用其自身的 Agent 与 LLM 配置；此处不会向 iframe 传递 Octop 登录令牌。</p>
            </form>
          )}
          {error && <div className="wb-alert" role="alert">{error}</div>}
          {platformSrc ? (
            <iframe key={platformSrc} title="星球乐园内置平台" className="wb-platform-frame" src={platformSrc}
              referrerPolicy="no-referrer" allow="fullscreen; clipboard-read; clipboard-write" />
          ) : (
            <div className="wb-platform-placeholder"><CircleHelp size={32} />
              <h2>请配置内置平台地址</h2>
              <p>仅允许当前私有云主机，避免把你的工作台嵌入不可信站点。</p>
              <button type="button" onClick={() => setPlatformSettingsOpen(true)}>配置地址</button>
            </div>
          )}
        </main>
      ) : (
        <main className="wb-main">
          <header className="wb-topbar">
            <div className="wb-breadcrumb"><span>LYRA SPACE</span><ChevronRight size={13}/><strong>{hasChat ? "对话工作台" : "工作台"}</strong></div>
            <div className="wb-topbar-right">
              <span className="wb-status"><span className={primary ? "wb-status-dot" : "wb-status-dot is-off"} />
                {agentsLoading ? "正在连接…" : primary ? "主 Agent 已连接" : "未发现运行中的 Agent"}
              </span>
              <span className="wb-topbar-divider" />
              <span className="wb-private-label"><ShieldCheck size={14}/> 私有云</span>
            </div>
          </header>

          {hasChat ? (
            <section className="wb-conversation" aria-label="主 Agent 对话">
              <div className="wb-conversation-head">
                <div className="wb-agent-bubble"><Bot size={25}/></div>
                <div><h1>{primary?.name || "主 Agent"}</h1>
                  <p>{teamReady ? "正在由主 Agent 统一规划与协调团队" : "单 Agent 模式 · 配置团队后即可自动分发任务"}</p>
                </div>
                <span className="wb-conversation-spacer" />
                <button type="button" className="wb-secondary-button" onClick={() => navigate(chatHref)}>
                  <ExternalLink size={15}/> 高级对话
                </button>
              </div>
              <div className="wb-chat-scroll" aria-live="polite" aria-relevant="additions text">
                {historyLoading && visibleMessages.length === 0 && <div className="wb-chat-loading">正在载入会话…</div>}
                {historyError && <div className="wb-alert" role="alert">会话加载失败。可以从高级对话中重试。</div>}
                {visibleMessages.map((message) => (
                  <article key={message.id} className={"wb-chat-message " + (message.role === "user" ? "is-user" : "is-agent")}>
                    <div className="wb-chat-avatar">{message.role === "user" ? displayName.slice(0, 1) : <Bot size={18}/>}</div>
                    <div className="wb-chat-message-body">
                      <div className="wb-chat-author">{message.role === "user" ? "你" : (primary?.name || "主 Agent")}
                        <time>{formatTime(message.timestamp)}</time></div>
                      <div className="wb-chat-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                    </div>
                  </article>
                ))}
                {isStreaming && <div className="wb-thinking"><Sparkles size={15}/> 主 Agent 正在处理任务…</div>}
                {hasPendingApproval && <div className="wb-approval">
                  <Wrench size={17} /><span>任务需要人工授权，请进入高级对话处理，避免误操作。</span>
                  <button type="button" onClick={() => navigate(chatHref)}>处理授权 <ArrowRight size={15}/></button>
                </div>}
                <div ref={bottomRef} />
              </div>
            </section>
          ) : (
            <section className="wb-welcome">
              <div className="wb-eyebrow"><span className="wb-eyebrow-mark">✳</span> YOUR PRIVATE AI WORKSPACE <span className="wb-eyebrow-mark">✳</span></div>
              <div className="wb-welcome-brand"><span className="wb-hero-bot"><Bot size={42} strokeWidth={1.8}/></span>
                <div><h1>你的想法，<em>交给我们。</em></h1>
                  <p>一个入口 · 一个主 Agent · 一整支协作团队</p>
                </div></div>
              <div className="wb-entry-grid">
                <button type="button" className="wb-entry-card wb-entry-primary"
                  onClick={() => inputRef.current?.focus()}>
                  <div className="wb-entry-top"><span className="wb-card-icon"><MessageCircle size={27}/></span><span className="wb-entry-label">01 / MAIN AGENT</span></div>
                  <h2>和主 Agent 聊聊 <ArrowRight size={22}/></h2>
                  <p>只管提出目标。任务拆解、Agent 调度与执行由主控统一完成。</p>
                  <div className="wb-entry-meta"><span className="wb-live-indicator"/>{teamReady ? "团队调度已就绪" : "需配置可调度的 Agent Team"}<span className="wb-figure">↗</span></div>
                </button>
                <button type="button" className="wb-entry-card wb-entry-platform" onClick={openPlatform}>
                  <div className="wb-entry-top"><span className="wb-card-icon"><Layers3 size={27}/></span><span className="wb-entry-label">02 / BUILT-IN PLATFORM</span></div>
                  <h2>进入内置平台 <ArrowRight size={22}/></h2>
                  <p>切换到沉浸式全屏应用。平台自主使用它的 Agent、模型和工作流。</p>
                  <div className="wb-entry-meta"><span className="wb-platform-tiny-icon">✦</span> 星球乐园 <span className="wb-figure">↗</span></div>
                </button>
              </div>
              <div className="wb-panel-caption"><span>✳</span> 从这里开始 <span className="wb-panel-caption-line" /></div>
              <div className="wb-starters">
                {PROMPTS.map((item, index) => (
                  <button type="button" key={item.title} onClick={() => {
                    setInput(item.text);
                    inputRef.current?.focus();
                  }}><span className="wb-starter-index">0{index + 1}</span>
                    <span>{item.title}</span><ArrowRight size={17}/></button>
                ))}
              </div>
              <div className="wb-agent-footnote">
                <div className="wb-agent-footnote-avatars"><span><Bot size={16}/></span><span><Workflow size={16}/></span><span><GraduationCap size={16}/></span></div>
                {teamReady ? "主 Agent 已连接 " + (primary?.member_ids?.length || 0) + " 位协作 Agent"
                  : "请在「Agent 团队」中建立一个 Team，才能启用真实任务分发。"}
                <button type="button" onClick={() => navigate("/experts")}>管理团队 <ChevronRight size={14}/></button>
              </div>
            </section>
          )}

          <div className={"wb-composer-wrap" + (hasChat ? " wb-composer-inchat" : "")}>
            {error && <div className="wb-alert" role="alert">{error}</div>}
            <div className="wb-composer">
              <textarea ref={inputRef} rows={2} value={input} onChange={(e) => setInput(e.target.value)}
                disabled={!primary || agentsLoading || sending}
                aria-label="给主 Agent 发消息"
                placeholder={primary ? "给主 Agent 一个任务，或者聊聊你的想法…" : "请先在 Agent 团队中启动主 Agent"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
                }} />
              <div className="wb-composer-bottom">
                <span className="wb-composer-model"><Bot size={15}/>{primary?.name || "等待主 Agent"}</span>
                <span className="wb-composer-privacy"><ShieldCheck size={14}/> 私有对话</span>
                <span className="wb-composer-spacer" />
                <span className="wb-composer-tip">Enter 发送 · Shift+Enter 换行</span>
                {isStreaming ?
                  <button type="button" className="wb-composer-send is-stop" onClick={cancelStream} aria-label="停止生成"><Square size={17}/></button> :
                  <button type="button" className="wb-composer-send"
                    disabled={!input.trim() || !primary || sending || hasPendingApproval}
                    onClick={() => void send()} aria-label="发送消息"><Send size={17}/></button>}
              </div>
            </div>
            <div className="wb-composer-caption">
              <span><ShieldCheck size={13}/> 数据保留在你的私有部署中</span>
              <span>此工作台只呈现聊天记录，内部执行明细在高级对话中查看。</span>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
