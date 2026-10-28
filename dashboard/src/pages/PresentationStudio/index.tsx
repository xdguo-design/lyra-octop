import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
} from "antd";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Download,
  FileText,
  FilePlus2,
  Layers,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Palette,
  Play,
  Send,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  presentationsApi,
  type PresentationChatTurn,
  type PresentationDeck,
  type PresentationRuntime,
  type PresentationSlide,
  type PresentationStyle,
} from "../../api/modules/presentations";
import { useAgent } from "../../context/AgentContext";
import { ownedSoloExperts } from "../../utils/sharedExpert";
import { saveBlobAsFile } from "../../utils/saveBlobAsFile";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import {
  formatMessageTime,
  formatServerDateTime,
  formatServerHourMinute,
} from "../../utils/formatMessageTime";
import ExpertAgentAvatar from "../Chat/components/ExpertAgentAvatar";
import styles from "./index.module.less";

const isBusy = (deck: PresentationDeck | null) =>
  !!deck && !["idle", "failed"].includes(deck.status);
const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const STYLE_KEYS: PresentationStyle[] = [
  "paper",
  "dark",
  "minimal",
  "business",
  "tech",
  "kids",
];

interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  action?: string | null;
  /** Epoch seconds, mirroring PresentationChatTurn.at. */
  at?: number;
  pending?: boolean;
}

let seq = 0;
const nextId = () => `ppt-msg-${(seq += 1)}-${Date.now()}`;

const toMs = (epochSec?: number) =>
  !epochSec ? 0 : epochSec > 1e12 ? epochSec : epochSec * 1000;

function SlideImage({
  slide,
  thumbnail = false,
}: {
  slide: PresentationSlide;
  thumbnail?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slide.svg) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([slide.svg], { type: "image/svg+xml" }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [slide.svg]);
  return url ? (
    <img className={styles.slideImage} src={url} alt={slide.title} />
  ) : (
    <div
      className={`${styles.pendingSlide} ${
        thumbnail ? styles.thumbnailText : ""
      }`}
    >
      <span>{slide.title}</span>
      {!thumbnail && <p>{slide.body}</p>}
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className={styles.progressRing} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="var(--fn-border-primary)"
        strokeWidth="3"
      />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="var(--fn-text-brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(100, Math.max(0, pct))) / 100} ${c}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export default function PresentationStudio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    agents,
    activeAgent,
    activeAgentId,
    loading: agentsLoading,
  } = useAgent();
  const timeZone = useServerTimezone();
  const candidates = ownedSoloExperts(agents).filter(
    (a) => !a.bridge_connection_id,
  );
  const agentId = candidates.some((a) => a.agent_id === activeAgentId)
    ? activeAgentId
    : null;
  const [decks, setDecks] = useState<PresentationDeck[]>([]);
  const [deck, setDeck] = useState<PresentationDeck | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<PresentationRuntime | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [chatTab, setChatTab] = useState<"assistant" | "history">("assistant");
  const [viewTab, setViewTab] = useState<"preview" | "outline">("preview");
  const listRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef(agentId);
  agentRef.current = agentId;
  const busy = isBusy(deck);
  const page = deck
    ? deck.slides[Math.min(selectedPage, Math.max(0, deck.slides.length - 1))]
    : undefined;
  const doneCount = deck ? deck.slides.filter((s) => !!s.svg).length : 0;
  const totalCount = deck ? deck.slides.length : 0;
  const model = activeAgent?.default_model || t("pptStudio.activeModel");

  const accept = useCallback((value: PresentationDeck) => {
    setDeck(value);
    setDecks((old) => [
      value,
      ...old.filter((d) => d.deck_id !== value.deck_id),
    ]);
  }, []);

  const openDeck = useCallback(
    async (owner: string, id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [value, log] = await Promise.all([
          presentationsApi.get(owner, id),
          presentationsApi
            .chatLog(owner, id)
            .catch(() => ({ messages: [] as PresentationChatTurn[] })),
        ]);
        if (agentRef.current !== owner) return;
        accept(value);
        setSelectedPage(0);
        setMessages(
          log.messages.map((turn) => ({
            id: nextId(),
            role: turn.role,
            text: turn.text,
            action: turn.action,
            at: turn.at,
          })),
        );
      } catch (err) {
        if (agentRef.current === owner) setError(errorText(err));
      } finally {
        if (agentRef.current === owner) setLoading(false);
      }
    },
    [accept],
  );

  useEffect(() => {
    let cancelled = false;
    setDeck(null);
    setDecks([]);
    setSelectedPage(0);
    setMessages([]);
    setError(null);
    if (!agentId) return;
    void (async () => {
      setLoading(true);
      try {
        const [items, state] = await Promise.all([
          presentationsApi.list(agentId),
          presentationsApi.runtime(agentId),
        ]);
        if (cancelled) return;
        setDecks(items);
        setRuntime(state);
        if (items.length) {
          await openDeck(agentId, items[0].deck_id);
          return; // openDeck manages loading
        }
        const log = await presentationsApi.chatLog(agentId);
        if (!cancelled && agentRef.current === agentId) {
          setMessages(
            log.messages.map((turn) => ({
              id: nextId(),
              role: turn.role,
              text: turn.text,
              action: turn.action,
              at: turn.at,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, openDeck]);

  useEffect(() => {
    if (!agentId || !deck?.deck_id || !busy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const owner = agentId;
    const deckId = deck.deck_id;
    const poll = async () => {
      try {
        const fresh = await presentationsApi.get(owner, deckId);
        if (stopped) return;
        if (!isBusy(fresh)) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "system",
              text:
                fresh.status === "failed"
                  ? t("pptStudio.jobFailed", { error: fresh.error || "" })
                  : t("pptStudio.jobDone"),
            },
          ]);
        }
        accept(fresh);
        if (isBusy(fresh)) timer = setTimeout(() => void poll(), 2000);
      } catch (err) {
        if (!stopped) {
          setError(errorText(err));
          timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [agentId, deck?.deck_id, busy, accept, t]);

  useEffect(() => {
    if (!deck) return;
    if (selectedPage >= deck.slides.length)
      setSelectedPage(Math.max(0, deck.slides.length - 1));
  }, [deck, selectedPage]);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || !agentId || sending) return;
      const owner = agentId;
      const capturedDeckId = deck?.deck_id;
      const userMsg: UiMessage = {
        id: nextId(),
        role: "user",
        text,
        at: Math.floor(Date.now() / 1000),
      };
      const botMsg: UiMessage = {
        id: nextId(),
        role: "assistant",
        text: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      setInput("");
      setSending(true);
      try {
        const resp = await presentationsApi.chatStream(
          owner,
          {
            ...(capturedDeckId ? { deck_id: capturedDeckId } : {}),
            message: text,
          },
          (delta) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botMsg.id
                  ? { ...m, text: m.text + delta, pending: false }
                  : m,
              ),
            ),
        );
        if (agentRef.current !== owner) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsg.id
              ? {
                  ...m,
                  text: resp.reply,
                  action: resp.action,
                  pending: false,
                }
              : m,
          ),
        );
        if (resp.deck) {
          accept(resp.deck);
          if (resp.deck.deck_id !== capturedDeckId) setSelectedPage(0);
        }
      } catch (err) {
        if (agentRef.current !== owner) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsg.id
              ? { ...m, text: errorText(err), pending: false }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [agentId, deck?.deck_id, sending, accept],
  );

  const exportDeck = async () => {
    if (!agentId || !deck || busy) return;
    const owner = agentId;
    setError(null);
    try {
      accept(
        await presentationsApi.job(owner, deck.deck_id, {
          revision: deck.revision,
          action: "export",
        }),
      );
    } catch (err) {
      if (agentRef.current === owner) setError(errorText(err));
    }
  };

  const download = async () => {
    if (!agentId || !deck) return;
    setDownloading(true);
    setError(null);
    try {
      await saveBlobAsFile(
        await presentationsApi.download(agentId, deck.deck_id),
        `${deck.title.replace(/[<>:"/\\|?*]/g, "_")}.pptx`,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDownloading(false);
    }
  };

  const suggestions = !deck
    ? [
        { text: t("pptStudio.suggestCreateA"), Icon: FileText },
        { text: t("pptStudio.suggestCreateB"), Icon: FilePlus2 },
      ]
    : busy
    ? []
    : deck.slides.some((s) => !s.svg)
    ? [{ text: t("pptStudio.suggestDeckA"), Icon: LayoutTemplate }]
    : [
        { text: t("pptStudio.suggestDeckA"), Icon: LayoutTemplate },
        { text: t("pptStudio.suggestDeckB"), Icon: Download },
      ];

  // The PPT workbench is bound to one platform-pinned agent; no in-page picker.
  const otherDecks = decks.filter((d) => d.deck_id !== deck?.deck_id);

  const deckMenu = {
    items: decks.map((d) => ({
      key: d.deck_id,
      label: (
        <span className={styles.menuDeck}>
          <b>{d.title}</b>
          <span>
            {t("pptStudio.deckMeta", {
              count: d.slides.length,
              time: formatMessageTime(toMs(d.updated_at), timeZone),
            })}
          </span>
        </span>
      ),
    })),
    onClick: ({ key }: { key: string }) => {
      if (agentId && key !== deck?.deck_id) void openDeck(agentId, key);
    },
    selectable: true,
    selectedKeys: deck ? [deck.deck_id] : [],
  };

  const styleMenu = {
    items: STYLE_KEYS.map((key) => ({
      key,
      label: t(`pptStudio.styles.${key}`),
    })),
    onClick: ({ key }: { key: string }) => {
      const label = t(`pptStudio.styles.${key}`);
      void send(t("pptStudio.setStyleAsk", { style: label }));
    },
    selectable: true,
    selectedKeys: deck ? [deck.style] : [],
  };

  const downloadMenu = {
    items: [
      {
        key: "download",
        icon: <Download size={13} />,
        label: t("pptStudio.download"),
        disabled: !deck?.export_path,
        onClick: () => void download(),
      },
    ],
  };

  const renderAgentAvatar = (size: number) =>
    activeAgent ? (
      <ExpertAgentAvatar
        iconName={activeAgent.icon_name}
        iconUrl={activeAgent.icon_url}
        color={activeAgent.color}
        size={size}
      />
    ) : (
      <span
        className={styles.botAvatarFallback}
        style={{ width: size, height: size }}
      >
        <Bot size={Math.round(size * 0.55)} />
      </span>
    );

  const statusLabel = deck ? t(`pptStudio.status.${deck.status}`) : "";
  const pct = totalCount ? (doneCount / totalCount) * 100 : 0;

  return (
    <div className={styles.page}>
      {(error || deck?.error) && (
        <Alert
          className={styles.alert}
          type="error"
          showIcon
          message={error || deck?.error}
          closable
          onClose={() => setError(null)}
        />
      )}
      {runtime && !runtime.installed && (
        <Alert
          className={styles.alert}
          type="warning"
          showIcon
          message={t("pptStudio.engineMissing")}
          description={t("pptStudio.engineMissingHint")}
        />
      )}
      {loading || agentsLoading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : !agentId ? (
        <div className={styles.empty}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("pptStudio.chooseOwnedExpert")}
          />
          <Button onClick={() => navigate("/experts")}>
            {t("pptStudio.manageExperts")}
          </Button>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.toolbar}>
            <div className={`${styles.ctxCard} ${styles.ctxCardStatic}`}>
              {renderAgentAvatar(36)}
              <span className={styles.ctxText}>
                <span className={styles.ctxTitle}>
                  {activeAgent?.name || t("pptStudio.selectExpert")}
                </span>
                <span className={styles.ctxSub}>
                  {activeAgent?.description || t("pptStudio.expert")}
                </span>
              </span>
            </div>
            {decks.length > 0 && (
              <Dropdown trigger={["click"]} menu={deckMenu}>
                <button
                  type="button"
                  className={styles.ctxCard}
                  aria-label={t("pptStudio.documents")}
                >
                  <span className={styles.docBadge}>
                    <FileText size={17} />
                  </span>
                  <span className={styles.ctxText}>
                    <span className={styles.ctxTitle}>
                      {deck?.title || t("pptStudio.documents")}
                    </span>
                    <span className={styles.ctxSub}>
                      {deck
                        ? t("pptStudio.deckMeta", {
                            count: totalCount,
                            time: formatMessageTime(
                              toMs(deck.updated_at),
                              timeZone,
                            ),
                          })
                        : t("pptStudio.selectExpert")}
                    </span>
                  </span>
                  <ChevronDown size={14} className={styles.ctxChevron} />
                </button>
              </Dropdown>
            )}
            <div className={styles.modelChip}>
              <span className={styles.modelBadge}>
                <Sparkles size={13} />
              </span>
              <span className={styles.modelName}>{model}</span>
              <span className={styles.miniTag}>{t("pptStudio.badgeChat")}</span>
              <span className={styles.miniTagLite}>
                {t("pptStudio.badgeRecommended")}
              </span>
            </div>
            <div className={styles.toolbarActions}>
              <Dropdown
                trigger={["click"]}
                menu={styleMenu}
                disabled={!deck || busy}
              >
                <Button icon={<Palette size={15} />}>
                  {t("pptStudio.styleButton")}
                </Button>
              </Dropdown>
              <Button
                icon={<Play size={14} />}
                disabled={!deck || !deck.slides.some((s) => s.svg)}
                onClick={() => setPresenting(true)}
              >
                {t("pptStudio.preview")}
              </Button>
              <Space.Compact className={styles.exportSplit}>
                <Button
                  type="primary"
                  icon={<Download size={15} />}
                  loading={downloading}
                  disabled={
                    deck?.export_path
                      ? false
                      : busy ||
                        !deck ||
                        !deck.slides.length ||
                        deck.slides.some((s) => !s.svg) ||
                        !runtime?.installed
                  }
                  onClick={() =>
                    deck?.export_path ? void download() : void exportDeck()
                  }
                >
                  {deck?.export_path
                    ? t("pptStudio.download")
                    : t("pptStudio.export")}
                </Button>
                <Dropdown trigger={["click"]} menu={downloadMenu}>
                  <Button
                    type="primary"
                    className={styles.exportMore}
                    aria-label={t("pptStudio.moreActions")}
                    icon={<ChevronDown size={14} />}
                  />
                </Dropdown>
              </Space.Compact>
            </div>
          </div>
          <div className={styles.workspace}>
            <section className={styles.chatPane}>
              <div className={styles.paneTabs} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatTab === "assistant"}
                  className={
                    chatTab === "assistant"
                      ? styles.paneTabActive
                      : styles.paneTab
                  }
                  onClick={() => setChatTab("assistant")}
                >
                  {t("pptStudio.tabAssistant")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatTab === "history"}
                  className={
                    chatTab === "history"
                      ? styles.paneTabActive
                      : styles.paneTab
                  }
                  onClick={() => setChatTab("history")}
                >
                  {t("pptStudio.tabHistory")} ({otherDecks.length})
                </button>
              </div>
              {chatTab === "assistant" ? (
                <div className={styles.chatMessages} ref={listRef}>
                  {messages.length === 0 ? (
                    <div className={styles.chatWelcome}>
                      {renderAgentAvatar(36)}
                      <div className={styles.welcomeBody}>
                        <b>{t("pptStudio.chatEmptyTitle")}</b>
                        <p>{t("pptStudio.chatEmptyDescription")}</p>
                        <div className={styles.suggestions}>
                          {suggestions.map((s) => (
                            <button
                              key={s.text}
                              type="button"
                              className={styles.suggestionChip}
                              onClick={() => void send(s.text)}
                            >
                              <s.Icon size={14} />
                              <span>{s.text}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    messages.map((m) =>
                      m.role === "system" ? (
                        <div key={m.id} className={styles.msgSystem}>
                          {m.text}
                        </div>
                      ) : m.role === "user" ? (
                        <div key={m.id} className={styles.msgRowUser}>
                          <div className={styles.msgUserCol}>
                            <div className={styles.msgUser}>{m.text}</div>
                            {!!m.at && (
                              <span className={styles.msgTime}>
                                {formatServerHourMinute(toMs(m.at), timeZone)}
                              </span>
                            )}
                          </div>
                          <span className={styles.userAvatar}>
                            <User size={14} />
                          </span>
                        </div>
                      ) : (
                        <div key={m.id} className={styles.msgRowBot}>
                          <span className={styles.botAvatarSlot}>
                            {renderAgentAvatar(30)}
                          </span>
                          <div className={styles.msgBotCol}>
                            {m.pending ? (
                              <span className={styles.thinking}>
                                <Loader2 size={13} className={styles.spin} />
                                {t("pptStudio.thinking")}
                              </span>
                            ) : (
                              <>
                                {m.action && m.action !== "none" && (
                                  <span className={styles.actionTag}>
                                    {t(`pptStudio.actions.${m.action}`, {
                                      defaultValue: m.action,
                                    })}
                                  </span>
                                )}
                                <p>{m.text}</p>
                              </>
                            )}
                          </div>
                        </div>
                      ),
                    )
                  )}
                  {busy && deck && (
                    <div className={styles.taskCard}>
                      <div className={styles.taskRow}>
                        <CheckCircle2 size={14} className={styles.taskOk} />
                        <span>{t("pptStudio.actions.create")}</span>
                        <span className={styles.taskLink}>{deck.title}</span>
                      </div>
                      <div className={styles.taskRow}>
                        <Loader2 size={14} className={styles.spin} />
                        <span>{statusLabel}</span>
                        {(deck.status === "generating" ||
                          deck.status === "revising") && (
                          <span className={styles.taskFrac}>
                            {doneCount}/{totalCount}
                          </span>
                        )}
                      </div>
                      <div className={styles.taskRow}>
                        <Clock size={14} className={styles.taskDim} />
                        <span>{t("pptStudio.taskEstimate")}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.historyList}>
                  {otherDecks.length === 0 ? (
                    <div className={styles.historyEmpty}>
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("pptStudio.historyEmpty")}
                      />
                    </div>
                  ) : (
                    otherDecks.map((d) => (
                      <button
                        key={d.deck_id}
                        type="button"
                        className={styles.historyRow}
                        onClick={() => {
                          if (agentId) void openDeck(agentId, d.deck_id);
                        }}
                      >
                        <span className={styles.historyIcon}>
                          <FileText size={16} />
                        </span>
                        <span className={styles.historyText}>
                          <b>{d.title}</b>
                          <span>
                            {t("pptStudio.deckMeta", {
                              count: d.slides.length,
                              time: formatMessageTime(
                                toMs(d.updated_at),
                                timeZone,
                              ),
                            })}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <div className={styles.composer}>
                <Input.TextArea
                  aria-label={t("pptStudio.chatPlaceholder")}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={t("pptStudio.chatPlaceholder")}
                  maxLength={4000}
                  autoSize={{ minRows: 1, maxRows: 5 }}
                />
                <div className={styles.composerHint}>
                  {t("pptStudio.chatHint")}
                </div>
                <div className={styles.composerRow}>
                  <span className={styles.spacer} />
                  <span className={styles.charCount}>
                    {input.length} / 4000
                  </span>
                  <Button
                    type="primary"
                    className={styles.sendBtn}
                    aria-label={t("pptStudio.send")}
                    icon={<Send size={14} />}
                    loading={sending}
                    disabled={!input.trim()}
                    onClick={() => void send(input)}
                  />
                </div>
              </div>
            </section>
            <section className={styles.previewPane}>
              <div className={styles.previewBar}>
                <div className={styles.paneTabs} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewTab === "preview"}
                    className={
                      viewTab === "preview"
                        ? styles.paneTabActive
                        : styles.paneTab
                    }
                    onClick={() => setViewTab("preview")}
                  >
                    {t("pptStudio.tabPreview")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewTab === "outline"}
                    className={
                      viewTab === "outline"
                        ? styles.paneTabActive
                        : styles.paneTab
                    }
                    onClick={() => setViewTab("outline")}
                  >
                    {t("pptStudio.tabOutline")}
                  </button>
                </div>
                <span className={styles.spacer} />
                {deck && (
                  <div className={styles.busyBadge}>
                    {busy && (
                      <>
                        <ProgressRing pct={pct} />
                        <span>{statusLabel}</span>
                      </>
                    )}
                    {!busy && deck.status === "failed" && (
                      <span className={styles.failText}>{statusLabel}</span>
                    )}
                    <strong className={styles.bigFrac}>
                      {doneCount} / {totalCount}
                    </strong>
                  </div>
                )}
              </div>
              {viewTab === "preview" ? (
                <>
                  <div className={styles.stage}>
                    {page ? (
                      <div className={styles.stageSlide}>
                        <SlideImage slide={page} />
                      </div>
                    ) : (
                      <div className={styles.startOutline}>
                        <Layers size={38} strokeWidth={1.2} />
                        <h2>{t("pptStudio.previewEmptyTitle")}</h2>
                        <p>{t("pptStudio.previewEmptyDescription")}</p>
                      </div>
                    )}
                  </div>
                  {deck && deck.slides.length > 0 && (
                    <>
                      <div className={styles.canvasBar}>
                        <Button
                          type="text"
                          size="small"
                          icon={<ChevronLeft size={15} />}
                          disabled={selectedPage <= 0}
                          aria-label={t("pptStudio.previous")}
                          onClick={() => setSelectedPage((i) => i - 1)}
                        />
                        <span className={styles.pageIndicator}>
                          {selectedPage + 1} / {totalCount}
                        </span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ChevronRight size={15} />}
                          disabled={selectedPage >= totalCount - 1}
                          aria-label={t("pptStudio.next")}
                          onClick={() => setSelectedPage((i) => i + 1)}
                        />
                        <span className={styles.spacer} />
                        <Button
                          type="text"
                          size="small"
                          icon={<Maximize2 size={14} />}
                          disabled={!deck.slides.some((s) => s.svg)}
                          aria-label={t("pptStudio.fullscreen")}
                          onClick={() => setPresenting(true)}
                        />
                      </div>
                      <div className={styles.thumbStrip}>
                        {deck.slides.map((s, i) => (
                          <button
                            key={s.slide_id}
                            type="button"
                            className={`${styles.thumbCard} ${
                              i === selectedPage ? styles.thumbSelected : ""
                            }`}
                            aria-label={`${i + 1} · ${s.title}`}
                            aria-pressed={i === selectedPage}
                            onClick={() => setSelectedPage(i)}
                          >
                            <span className={styles.thumbImage}>
                              <SlideImage slide={s} thumbnail />
                            </span>
                            <span className={styles.thumbLabel}>
                              <span className={styles.thumbNum}>{i + 1}</span>
                              <span className={styles.thumbTitle}>
                                {s.title}
                              </span>
                            </span>
                            <span
                              className={
                                s.svg ? styles.readyDot : styles.pendingDot
                              }
                            />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className={styles.outlinePane}>
                  {deck && deck.slides.length > 0 ? (
                    <>
                      <div className={styles.outlineSummary}>
                        {t("pptStudio.outlineSummary", {
                          count: totalCount,
                          style: t(`pptStudio.styles.${deck.style}`, {
                            defaultValue: deck.style,
                          }),
                        })}
                      </div>
                      {deck.slides.map((s, i) => (
                        <div key={s.slide_id} className={styles.outlineRow}>
                          <b>{String(i + 1).padStart(2, "0")}</b>
                          <span className={styles.outlineTitle}>{s.title}</span>
                          <span
                            className={
                              s.svg ? styles.tagDone : styles.tagPending
                            }
                          >
                            {s.svg
                              ? t("pptStudio.outlineDone")
                              : t("pptStudio.outlinePending")}
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className={styles.historyEmpty}>
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("pptStudio.previewEmptyTitle")}
                      />
                    </div>
                  )}
                </div>
              )}
              {deck && (
                <footer className={styles.infoBar}>
                  <div className={styles.infoGroup}>
                    <em>{t("pptStudio.infoDeck")}</em>
                    <div className={styles.infoChips}>
                      <span>
                        <FileText size={13} />
                        {t("pptStudio.pagesCount", { count: totalCount })}
                      </span>
                      <i className={styles.chipDivider} />
                      <span>
                        <Palette size={13} />
                        {t(`pptStudio.styles.${deck.style}`, {
                          defaultValue: deck.style,
                        })}
                      </span>
                      {deck.audience && (
                        <>
                          <i className={styles.chipDivider} />
                          <span>
                            <Users size={13} />
                            {deck.audience}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <i className={styles.infoDivider} />
                  <div className={`${styles.infoGroup} ${styles.infoStatus}`}>
                    <em>{t("pptStudio.infoStatus")}</em>
                    <div className={styles.infoChips}>
                      {busy ? (
                        <Loader2 size={13} className={styles.spin} />
                      ) : deck.status === "failed" ? (
                        <span className={styles.failText}>×</span>
                      ) : (
                        <CheckCircle2 size={13} className={styles.doneIcon} />
                      )}
                      <span>{statusLabel}</span>
                    </div>
                    <div className={styles.infoProgress}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <i className={styles.infoDivider} />
                  <div className={styles.infoGroup}>
                    <em>{t("pptStudio.model")}</em>
                    <b>{model}</b>
                  </div>
                  <i className={styles.infoDivider} />
                  <div className={styles.infoGroup}>
                    <em>{t("pptStudio.infoEngine")}</em>
                    <b className={styles.engineValue}>
                      <Cpu size={13} />
                      PPT Master v{runtime?.version || "—"}
                    </b>
                  </div>
                  <i className={styles.infoDivider} />
                  <div className={styles.infoGroup}>
                    <em>{t("pptStudio.infoSaved")}</em>
                    <b>{formatServerDateTime(deck.updated_at, timeZone)}</b>
                  </div>
                </footer>
              )}
            </section>
          </div>
        </div>
      )}
      <Modal
        open={presenting}
        onCancel={() => setPresenting(false)}
        footer={null}
        width="90vw"
        title={deck?.title}
        destroyOnHidden
      >
        <div className={styles.presentSlide}>
          {page && <SlideImage slide={page} />}
        </div>
        <div className={styles.presentControls}>
          <Button
            disabled={selectedPage <= 0}
            onClick={() => setSelectedPage((i) => i - 1)}
          >
            {t("pptStudio.previous")}
          </Button>
          <span>
            {selectedPage + 1} / {deck?.slides.length || 0}
          </span>
          <Button
            disabled={!deck || selectedPage >= deck.slides.length - 1}
            onClick={() => setSelectedPage((i) => i + 1)}
          >
            {t("pptStudio.next")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
