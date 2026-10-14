import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dayjs from "dayjs";
import {
  ArrowLeft, ArrowRight, Bot, Boxes, ChevronRight, CircleHelp,
  Database, ExternalLink, GraduationCap, Layers3, Monitor, SquarePen,
  Maximize2, MessageCircle, MessageSquareText, Plus,
  Send, Settings2, ShieldCheck, Sparkles, Timer, Users,
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
  { path: "/remote-desktop", label: "电脑", Icon: Monitor },
  { path: "/experts", label: "Agent", Icon: Users },
  { path: "/knowledge-bases", label: "资料库", Icon: Database },
  { path: "/workbench", label: "创作", Icon: SquarePen },
  { path: "/tasks", label: "自动化", Icon: Timer },
  { path: "/admin/plugins", label: "插件", Icon: Boxes },
];
const MORE_ITEMS = [
  { path: "/token-usage", label: "Token 统计" },
  { path: "/admin/models", label: "模型与算力" },
  { path: "/personalization/skills", label: "个性化" },
  { path: "/connectors", label: "连接器" },
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
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [user, setUser] = useState<MeUser | null>(null);
  const [agents, setAgents] = useState<OctopAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [preferredHostId, setPreferredHostId] = useState(() => {
    try { return window.localStorage.getItem("octop:workbench:primary-agent") || ""; }
    catch { return ""; }
  });
  const [threads, setThreads] = useState<OctopThread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [platformOpen, setPlatformOpen] = useState(false);
  const [platformFrameReady, setPlatformFrameReady] = useState(false);
  const [platformSettingsOpen, setPlatformSettingsOpen] = useState(false);
  const [platformUrl, setPlatformUrl] = useState(initialPlatformUrl);
  const [platformDraft, setPlatformDraft] = useState(initialPlatformUrl);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if ((location.state as { newProject?: boolean } | null)?.newProject) {
      setInput("请帮我规划一个新项目，先明确目标、交付物和任务分工：");
    }
  }, [location.state]);

  const primary = useMemo(() => selectPrimaryAgent(agents, preferredHostId), [agents, preferredHostId]);
  const hostOptions = useMemo(() => {
    const available = agents.filter((a) => a.state === "running" && !a.bridge);
    const teams = available.filter((a) => a.kind === "team");
    return teams.length ? teams : available;
  }, [agents]);
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
    () => resolvePrivatePlatformUrl(platformUrl, window.location.hostname, window.location.protocol),
    [platformUrl],
  );
  const members = useMemo(
    () => (primary?.member_ids ?? []).map((id) =>
      agents.find((agent) => agent.agent_id === id) ?? null
    ).filter((member): member is OctopAgent => member !== null),
    [primary?.member_ids, agents],
  );
  const activeMembers = members.filter((member) => member.state === "running").length;
  const configuredMembers = primary?.member_ids?.length ?? 0;

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
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
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
    const next = resolvePrivatePlatformUrl(platformDraft, window.location.hostname, window.location.protocol);
    if (!next) {
      setError("平台地址必须是当前私有云主机的安全地址；HTTPS 工作台不能加载 HTTP 平台。");
      return;
    }
    setPlatformUrl(next);
    setPlatformFrameReady(false);
    try { window.localStorage.setItem("octop:workbench:planet-url", next); } catch { /* storage optional */ }
    setError("");
    setPlatformSettingsOpen(false);
  };

  const openPlatform = () => {
    setError("");
    setPlatformFrameReady(false);
    setPlatformOpen(true);
    setPlatformSettingsOpen(false);
  };
  const chooseHost = (id: string) => {
    setPreferredHostId(id);
    try { window.localStorage.setItem("octop:workbench:primary-agent", id); }
    catch { /* browser storage may be disabled */ }
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
            <span className="wb-brand-mark"><img src="/lyra-dino.svg" alt="" width="36" height="36" /></span>
            <span className="wb-brand-copy"><strong>LYRA</strong><small>私有云工作台</small></span>
          </button>
          <button className="wb-newtask" type="button" onClick={newTask}>
            <Plus size={18} /> 新建任务 <span className="wb-newtask-shortcut">+</span>
          </button>
          <nav className="wb-nav" aria-label="主导航">
            {NAV_ITEMS.map(({ path, label, Icon }) => (
              <button type="button" key={path} className="wb-nav-item"
                onClick={() => navigate(path)}>
                {label === "Agent" ? <img src="/lyra-dino.svg" width="19" height="19" alt="" /> : <Icon size={17} />}
                <span>{label}</span>
                {label === "Agent" && <span className="wb-cue">Cue!</span>}
              </button>
            ))}
            <Popover trigger="click" open={moreOpen} onOpenChange={setMoreOpen}
              placement="rightTop" arrow={false}
              content={<div className="wb-menu-popup">
                {MORE_ITEMS.map((item) => <button type="button" key={item.path}
                  onClick={() => { setMoreOpen(false); navigate(item.path); }}>{item.label}</button>)}
              </div>}>
              <button className="wb-nav-item" type="button" aria-expanded={moreOpen}>
                <span className="wb-more-dots">•••</span><span>更多</span><ChevronRight size={15} className="wb-nav-chevron" />
              </button>
            </Popover>
          </nav>
          <div className="wb-sidebar-section"><strong>项目</strong></div>
          <button type="button" className="wb-nav-item wb-project-new" onClick={() => {
            newTask();
            setInput("请帮我规划一个新项目，先明确目标、交付物和任务分工：");
          }}><Plus size={17}/><span>新项目</span></button>
          <div className="wb-sidebar-section"><strong>任务</strong><span>{threads.length}</span></div>
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
          <Popover trigger="click" open={profileOpen} onOpenChange={setProfileOpen}
            placement="topLeft" arrow={false}
            content={<div className="wb-menu-popup" role="menu">
              <button type="button" onClick={() => { setProfileOpen(false); navigate("/personalization/skills"); }}>
                <Settings2 size={16}/> 设置
              </button>
              <button type="button" onClick={() => { setProfileOpen(false); navigate("/experts"); }}>
                <Users size={16}/> Agent 管理
              </button>
            </div>}>
            <button type="button" className="wb-sidebar-footer" aria-expanded={profileOpen}>
              <span className="wb-user-avatar">{displayName.slice(0, 1)}</span>
              <span>{displayName}</span>
              <span className="wb-footer-space" />
              <ChevronRight size={16}/>
            </button>
          </Popover>
        </aside>
      )}

      {platformOpen ? (
        <main className="wb-platform-shell">
          <div className="wb-platform-bar">
            <button type="button" className="wb-platform-back" onClick={() => setPlatformOpen(false)}>
              <ArrowLeft size={18} /> 返回工作台
            </button>
            <div className="wb-platform-title"><span className="wb-platform-icon"><Layers3 size={18} /></span>
              <strong>星球乐园</strong><small>已开发的独立工作台 · 使用平台自身功能</small>
            </div>
            <div className="wb-platform-actions">
              {platformSrc && <a className="wb-platform-external" href={platformSrc} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15}/> 新窗口打开
              </a>}
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
              <p>这里接入现有的星球乐园工作台，不重建它的页面。平台的 Agent、模型及登录由平台自身管理；LYRA 不会将登录令牌传入平台。</p>
            </form>
          )}
          {error && <div className="wb-alert" role="alert">{error}</div>}
          {platformSrc ? (
            <div className="wb-platform-viewport">
              {!platformFrameReady && <div className="wb-platform-loading" role="status">正在打开星球乐园的已有工作台…</div>}
              <iframe key={platformSrc} title="星球乐园 · 独立工作台" className="wb-platform-frame" src={platformSrc}
                onLoad={() => setPlatformFrameReady(true)}
                referrerPolicy="no-referrer" allow="fullscreen; clipboard-read; clipboard-write" allowFullScreen />
            </div>
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
            <div className="wb-breadcrumb"><span>LYRA SPACE</span><ChevronRight size={13}/><strong>工作台</strong>
              <div className="wb-mode-tabs" role="group" aria-label="工作区模式">
                <button type="button" className="is-selected" aria-current="page" onClick={() => setPlatformOpen(false)}>
                  <MessageCircle size={14}/> 主 Agent 对话
                </button>
                <button type="button" onClick={openPlatform}><Layers3 size={14}/> 内置平台</button>
              </div>
            </div>
            <div className="wb-topbar-right">
              <span className="wb-status"><span className={primary ? "wb-status-dot" : "wb-status-dot is-off"} />
                {agentsLoading ? "正在连接…" : primary ? "主 Agent 已连接" : "未发现运行中的 Agent"}
              </span>
              <span className="wb-topbar-divider" />
              <span className="wb-private-label"><ShieldCheck size={14}/> 私有云</span>
            </div>
          </header>

          <div className="wb-workspace-body">
            <div className="wb-center-column">
          {hasChat ? (
            <section className="wb-conversation" aria-label="主 Agent 对话">
              <div className="wb-conversation-head">
                <div className="wb-agent-bubble"><img src="/lyra-dino.svg" alt="" width="36" height="36" /></div>
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
                    <div className="wb-chat-avatar">{message.role === "user" ? displayName.slice(0, 1) : <img src="/lyra-dino.svg" width="27" height="27" alt="" />}</div>
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
              <div className="wb-welcome-brand"><span className="wb-hero-bot"><img src="/lyra-dino.svg" width="58" height="58" alt="" /></span>
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
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
                }} />
              <div className="wb-composer-bottom">
                <span className="wb-composer-model"><Bot size={15}/>{primary?.name || "等待主 Agent"}</span>
                <span className="wb-composer-privacy"><ShieldCheck size={14}/> 私有部署</span>
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
              <span><ShieldCheck size={13}/> 会话由私有部署管理，模型调用依照已配置的提供商</span>
              <span>此工作台只呈现聊天记录，内部执行明细在高级对话中查看。</span>
            </div>
          </div>
            </div>
            <aside className="wb-insight-panel" aria-label="主 Agent 和内置平台">
              <section className="wb-insight-card wb-insight-host">
                <div className="wb-insight-head">
                  <span className="wb-insight-bot"><img src="/lyra-dino.svg" width="33" height="33" alt="" /></span>
                  <div><strong>{primary?.name || "主 Agent"}</strong>
                    <small>{primary ? "已连接" : "等待启用"}</small>
                  </div>
                  <span className={"wb-insight-status" + (primary ? " is-online" : "")}>{primary ? "在线" : "离线"}</span>
                </div>
                {hostOptions.length > 1 && (
                  <label className="wb-host-selector">
                    <span>对话主控</span>
                    <select aria-label="选择主 Agent" value={primary?.agent_id || ""}
                      onChange={(e) => chooseHost(e.target.value)}>
                      {hostOptions.map((agent) => (
                        <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <p>{teamReady
                  ? "向主 Agent 描述任务目标，它会通过已有 Agent Team 调用专业成员并汇总结果。"
                  : "当前尚未配置完整的协作团队，可以先与已启动的 Agent 聊天。"}
                </p>
                <button type="button" className="wb-insight-link" onClick={() => navigate("/experts")}>
                  管理主 Agent 与团队 <ChevronRight size={14}/>
                </button>
              </section>
              <section className="wb-insight-card wb-insight-team">
                <div className="wb-insight-section-title">
                  <div><strong>Agent 团队</strong><small>任务调度由主 Agent 负责</small></div>
                  <span className="wb-team-count">{activeMembers}/{configuredMembers} 已启动</span>
                </div>
                {configuredMembers === 0 ? (
                  <div className="wb-insight-empty">
                    <Workflow size={23}/>
                    <span>尚未配置协作成员</span>
                    <button type="button" onClick={() => navigate("/experts")}>创建 Agent Team <ArrowRight size={14}/></button>
                  </div>
                ) : (
                  <div className="wb-member-list">
                    {(primary?.member_ids ?? []).map((id, i) => {
                      const member = agents.find((agent) => agent.agent_id === id);
                      return <div className="wb-member" key={id}>
                        <span className="wb-member-index">{String(i + 1).padStart(2, "0")}</span>
                        <span className="wb-member-name">{member?.name || id}</span>
                        <span className={"wb-member-state" + (member?.state === "running" ? " is-running" : "")}>
                          {!member ? "状态未知" : member.state === "running" ? "已启动" : "未启动"}
                        </span>
                      </div>;
                    })}
                  </div>
                )}
                <div className="wb-team-foot">
                  <span className={"wb-team-dot" + (isStreaming ? " is-streaming" : "")} />
                  {isStreaming ? "当前会话有任务正在处理" : "这里展示成员可用性，不代表任务执行进度"}
                </div>
              </section>
              <section className="wb-insight-card wb-insight-platform">
                <div className="wb-insight-section-title">
                  <div><strong>内置平台</strong><small>已开发、可独立使用的工作台</small></div>
                  <Layers3 size={19}/>
                </div>
                <button type="button" className="wb-platform-tile" onClick={openPlatform}>
                  <span className="wb-platform-planet"><Layers3 size={24}/></span>
                  <span><strong>星球乐园</strong><small>打开现有工作台，使用完整平台功能</small></span>
                  <ArrowRight size={17}/>
                </button>
                <p className="wb-platform-note">进入后平台会尽可能占满窗口；LYRA 不复制或替换平台的原有业务界面。</p>
              </section>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
