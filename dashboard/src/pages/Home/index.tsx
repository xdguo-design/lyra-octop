import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import {
  createPath,
  parsePath,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  useLocation,
  useNavigate,
  type Location,
  type Navigator,
  type To,
} from "react-router-dom";
import MainLayout from "../../layouts/MainLayout";
import { Modal, Popover, Dropdown, Select, Input, Button, Spin } from "antd";
import RequirePermission from "../../components/RequirePermission";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dayjs from "dayjs";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Cpu,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  ExternalLink,
  Folder,
  HardDrive,
  Library,
  Layers3,
  LogOut,
  Mic,
  Monitor,
  Moon,
  Paperclip,
  Pencil,
  SquarePen,
  Maximize2,
  MessageCircle,
  MessageSquareText,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Timer,
  Trash2,
  UserCog,
  Users,
  Menu,
  LockKeyhole,
  Wrench,
  RotateCcw,
  X,
} from "lucide-react";
import { clearAuthToken, request } from "../../api/request";
import {
  octopThreadsApi,
  CHAT_HISTORY_PAGE_SIZE,
  type OctopThread,
} from "../../api/modules/octopThreads";
import {
  creationsApi,
  type CreationItem,
  type ProjectLaunchStatus,
} from "../../api/modules/creations";
import AuthImage from "../../components/AuthImage";
import {
  workbenchApi,
  type WorkbenchAssignment,
  type WorkbenchFolder,
  type WorkbenchProject,
} from "../../api/modules/workbench";
import { preferencesApi } from "../../api/modules/preferences";
import { providerApi } from "../../api/modules/provider";
import { acpApi } from "../../api/modules/acp";
import type { ACPRunnerConfig } from "../../api/types/acp";
import {
  knowledgeBasesApi,
  type KnowledgeBase,
} from "../../api/modules/knowledgeBases";
import { authApi } from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import {
  MIN_PASSWORD_LENGTH,
  passwordPolicyIssue,
} from "../../utils/passwordPolicy";
import { message } from "../../utils/antdMessage";
import {
  ProfileAvatar,
  ProfileAvatarPicker,
} from "../Admin/Users/ProfileAvatar";
import type { ResolvedModel } from "../../api/types";
import { applyGuestLocale, applyUserLocale } from "../../utils/locale";
import { isRunningInFrame } from "../../utils/framed";
import { useTheme } from "../../context/ThemeContext";
import { useChat } from "../Chat/hooks/useChat";
import {
  confirmDeleteConversation,
  deleteConversation,
} from "../Chat/utils/deleteConversation";
import { clipThreadTitle } from "../Chat/utils/threadTitle";
import { type ThemePreference } from "../../styles/appearanceStorage";
import { VISUAL_SKINS, type VisualSkin } from "../../styles/visualSkins";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useChatAttachments } from "../Chat/hooks/useChatAttachments";
import ExpertAgentAvatar from "../Chat/components/ExpertAgentAvatar";
import { blocksAcpOutboundFromConfig } from "../Experts/components/agentBackendForm";
import AssistantTurnView from "../Chat/components/AssistantTurnView";
import { groupConsecutiveAssistantMessages } from "../Chat/utils/messageGrouping";
import EmojiPicker from "../../components/EmojiPicker";
import ProjectCodeBrowser from "./ProjectCodeBrowser";
import ProjectContextDialog from "./ProjectContextDialog";
import ProjectRunsDialog from "./ProjectRunsDialog";
import ProjectShareDialog from "./ProjectShareDialog";
import { BUILT_IN_CREATIONS } from "../Creations/builtInCreations";
import { isSttAvailable, useVoiceInput } from "../../hooks/useVoiceInput";
import type { OctopAgent } from "../../context/AgentContext";
import { modelOptionLabel, modelOptionValue } from "../../utils/modelOptions";
import {
  canDelegate,
  resolvePrivatePlatformUrl,
  selectPrimaryAgent,
  supportsLocalProjectPreview,
  visibleConversationMessages,
} from "./workbench-model";
import "./home-workbench.css";

function compareThreadRecency(a: OctopThread, b: OctopThread) {
  const aTime = a.last_active > 0 ? a.last_active : a.created_at;
  const bTime = b.last_active > 0 ? b.last_active : b.created_at;
  return bTime - aTime || b.thread_id.localeCompare(a.thread_id);
}

interface MeUser {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
  avatar_icon?: string | null;
  avatar_url?: string | null;
}

function isLaunchableProjectUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "github.com" &&
      !url.port &&
      /^\/[^/]+\/[^/]+(?:\.git)?\/?$/.test(url.pathname) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const NAV_ITEMS = [
  // 私有云/NAS 形态：Agent 跑在云主机上，不提供"电脑"远程控制入口。
  // 插件等中间过程入口收进「更多」菜单（MORE_ITEMS）。
  { path: "/experts", label: "Agent", Icon: Users },
  { path: "/knowledge-bases", label: "资料库", Icon: Library },
  { path: "/creations", label: "创作", Icon: SquarePen },
  { path: "/tasks", label: "自动化", Icon: Timer },
];
const MORE_ITEMS = [
  { path: "/apps", label: "应用目录" },
  { path: "/admin/models", label: "模型与算力" },
  { path: "/acp", label: "ACP 协作" },
  { path: "/admin/plugins", label: "插件" },
  { path: "/skill-packages", label: "技能包" },
  { path: "/personalization", label: "个性化" },
  { path: "/token-usage", label: "Token 统计" },
  { path: "/connectors", label: "连接器" },
  { path: "/bridge", label: "云端协同" },
];

/** Manus 式设置中心：左栏分组导航；「通用」内嵌语言/主题。
 *  只放账户与系统——功能/工具类入口的唯一家是侧栏「更多」菜单（MORE_ITEMS），别在这里重复。 */
const SETTINGS_NAV = [
  {
    title: "账户与团队",
    items: [
      {
        path: "/experts",
        label: "Agent 团队",
        desc: "主控与协作成员",
        Icon: Users,
      },
      {
        path: "/personalization/mbti",
        label: "个性与记忆",
        desc: "人格、记忆与偏好",
        Icon: Sparkles,
      },
      {
        path: "/admin/users",
        label: "用户管理",
        desc: "账号与登录方式",
        Icon: UserCog,
      },
    ],
  },
  {
    title: "系统",
    items: [
      {
        path: "/admin/storage",
        label: "存储管理",
        desc: "会话与文件存储",
        Icon: HardDrive,
      },
      {
        path: "/admin/security",
        label: "安全与权限",
        desc: "私有部署安全设置",
        Icon: LockKeyhole,
      },
      {
        path: "/admin/advanced",
        label: "高级设置",
        desc: "系统参数与运维",
        Icon: SlidersHorizontal,
      },
    ],
  },
] as const;

/** 设置弹窗各分区对应的页面：点击左栏菜单后在弹窗右侧面板内直接渲染，不再跳转主页面。
 *  内嵌页面运行在隔离的内存导航上下文里，页内 ?tab= / 路径变化不会污染底层页面路由。 */
const SETTINGS_SECTIONS: Record<string, LazyExoticComponent<ComponentType>> = {
  "/experts": lazy(() => import("../Experts")),
  "/personalization/mbti": lazy(() => import("../Agent/Personalization")),
  "/admin/users": lazy(() => import("../Admin/Users")),
  "/admin/storage": lazy(() => import("../Admin/Storage")),
  "/admin/security": lazy(() => import("../Settings/Security")),
  "/admin/advanced": lazy(() => import("../Settings/AdvancedSettings")),
};

/** 个性与记忆页内切换 Tab 会在 /personalization/* 之间跳转，分区分缀取父路径。 */
function settingsSectionPrefix(path: string): string {
  return path.startsWith("/personalization") ? "/personalization" : path;
}

/** 内嵌页面在隔离上下文里跳出分区分缀（如专家卡片「对话」→ /chat/...）时，
 *  把目标交给外层真实导航并关闭弹窗。 */
function SettingsSectionGuard({
  prefix,
  onExit,
}: {
  prefix: string;
  onExit: (to: string) => void;
}) {
  const location = useLocation();
  const lastRef = useRef(location);
  useEffect(() => {
    if (lastRef.current === location) return;
    lastRef.current = location;
    const inside =
      location.pathname === prefix ||
      location.pathname.startsWith(`${prefix}/`);
    if (!inside) {
      onExit(`${location.pathname}${location.search}${location.hash}`);
    }
  }, [location, prefix, onExit]);
  return null;
}

/** 为内嵌分区提供独立的内存导航上下文。react-router v7 禁止嵌套 <Router>
 *  （<MemoryRouter>/<RouterProvider> 都会触发不变式），因此用其 UNSAFE 上下文
 *  手工搭建与 <MemoryRouter> 等价的最小实现；面板页只用到 push/replace。 */
function SettingsIsolatedRouter({
  initialPath,
  children,
}: {
  initialPath: string;
  children: ReactNode;
}) {
  const [location, setLocation] = useState<Location>(() => ({
    pathname: initialPath,
    search: "",
    hash: "",
    state: null,
    key: "settings-root",
  }));
  const keyRef = useRef(1);
  const apply = useCallback((to: To, state?: unknown) => {
    const path = typeof to === "string" ? parsePath(to) : to;
    setLocation({
      pathname: path.pathname ?? "/",
      search: path.search ?? "",
      hash: path.hash ?? "",
      state: state ?? null,
      key: `settings-${(keyRef.current += 1)}`,
    });
  }, []);
  const navigator = useMemo<Navigator>(
    () => ({
      push: apply,
      replace: apply,
      go: () => {},
      createHref: (to) => (typeof to === "string" ? to : createPath(to)),
      encodeLocation: (to) => {
        const path = typeof to === "string" ? parsePath(to) : to;
        return {
          pathname: path.pathname ?? "",
          search: path.search ?? "",
          hash: path.hash ?? "",
        };
      },
    }),
    [apply],
  );
  const navValue = {
    basename: "/",
    navigator,
    static: false,
  } as ComponentProps<typeof UNSAFE_NavigationContext.Provider>["value"];
  const locValue = { location, navigationType: "POP" } as ComponentProps<
    typeof UNSAFE_LocationContext.Provider
  >["value"];
  const routeValue = {
    matches: [],
    outlet: null,
    isDataRoute: false,
  } as ComponentProps<typeof UNSAFE_RouteContext.Provider>["value"];
  return (
    <UNSAFE_NavigationContext.Provider value={navValue}>
      <UNSAFE_LocationContext.Provider value={locValue}>
        <UNSAFE_RouteContext.Provider value={routeValue}>
          {children}
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
}

function SettingsSectionPanel({
  path,
  onExit,
}: {
  path: string;
  onExit: (to: string) => void;
}) {
  const Page = SETTINGS_SECTIONS[path];
  if (!Page) return null;
  return (
    <SettingsIsolatedRouter key={path} initialPath={path}>
      <SettingsSectionGuard
        prefix={settingsSectionPrefix(path)}
        onExit={onExit}
      />
      {/* RequirePermission 读取隔离上下文的路径，和主布局一致地拦截无权限的管理页。 */}
      <RequirePermission>
        <Page />
      </RequirePermission>
    </SettingsIsolatedRouter>
  );
}

const FEATURE_TITLES: Record<string, string> = {
  "/experts": "Agent",
  "/knowledge-bases": "资料库",
  "/workbench": "终端工作台",
  "/creations": "创作",
  "/tasks": "自动化",
  "/admin/plugins": "插件",
  "/token-usage": "Token 统计",
  "/connectors": "连接器",
  "/bridge": "云端协同",
  "/admin/models": "模型与算力",
  "/personalization": "个性化",
  "/admin/security": "安全与权限",
  "/admin/users": "用户管理",
  "/admin/storage": "存储管理",
  "/admin/advanced": "高级设置",
  "/skill-packages": "技能包",
  "/agent-config": "Agent 配置",
  "/acp": "ACP 协作",
  "/chat": "高级对话",
};

function featureTitle(path: string) {
  const segment = Object.keys(FEATURE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + "/"));
  return segment ? FEATURE_TITLES[segment] : "工作台功能";
}

const THEME_OPTIONS = [
  { key: "light", label: "浅色", Icon: Sun },
  { key: "dark", label: "深色", Icon: Moon },
  { key: "system", label: "自动", Icon: Monitor },
] as const satisfies readonly {
  key: ThemePreference;
  label: string;
  Icon: typeof Sun;
}[];

const THEME_GALLERY_ORDER = [
  "cloud",
  "doodle",
  "journal",
  "forest",
  "orbit",
  "terminal",
  "clearSky",
  "cloudSea",
  "greatWall",
  "mogaoCaves",
  "changbaiMountain",
  "woodland",
  "bambooForest",
] satisfies VisualSkin[];
const THEME_GALLERY_OPTIONS = THEME_GALLERY_ORDER.map(
  (id) => VISUAL_SKINS.find((skin) => skin.id === id)!,
);

/** Legacy project data is imported once into account storage. */
function legacyProjectsStorageKey(agentId: string | null) {
  return `octop:workbench:projects:${agentId || "default"}`;
}
function archivedStorageKey(agentId: string | null) {
  return `octop:workbench:archived:${agentId || "default"}`;
}
function loadLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLocalJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage optional */
  }
}

function formatTime(value: number) {
  if (!value) return "";
  const d = dayjs(value < 1e12 ? value * 1000 : value);
  return d.isSame(dayjs(), "day") ? d.format("HH:mm") : d.format("MM/DD");
}

function initialPlatformUrl() {
  const configured = import.meta.env.VITE_LYRA_PLANET_URL as string | undefined;
  const guessed =
    window.location.protocol + "//" + window.location.hostname + ":8130/";
  try {
    return (
      window.localStorage.getItem("octop:workbench:planet-url") ||
      configured ||
      guessed
    );
  } catch {
    return configured || guessed;
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHomeRoute =
    location.pathname === "/home" || location.pathname === "/";
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 当前内嵌的设置分区（SETTINGS_NAV 的 path）；null = 「通用」面板。 */
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("octop:wb-side-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [user, setUser] = useState<MeUser | null>(null);
  const moreItems =
    user?.role === "admin"
      ? [{ path: "/admin/overview", label: "系统管理总览" }, ...MORE_ITEMS]
      : MORE_ITEMS;
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwOld, setPwOld] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const nameDirtyRef = useRef(false);
  const [agents, setAgents] = useState<OctopAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [preferredHostId, setPreferredHostId] = useState(() => {
    try {
      return window.localStorage.getItem("octop:workbench:primary-agent") || "";
    } catch {
      return "";
    }
  });
  const [threads, setThreads] = useState<OctopThread[]>([]);
  const [projects, setProjects] = useState<WorkbenchProject[]>([]);
  const [folders, setFolders] = useState<WorkbenchFolder[]>([]);
  const [recycledFolders, setRecycledFolders] = useState<WorkbenchFolder[]>([]);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [assignments, setAssignments] = useState<WorkbenchAssignment[]>([]);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("octop:wb-projects-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [tasksCollapsed, setTasksCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("octop:wb-tasks-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleProjectsCollapsed = () => {
    setProjectsCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(
          "octop:wb-projects-collapsed",
          next ? "1" : "0",
        );
      } catch {
        /* storage optional */
      }
      return next;
    });
  };
  const toggleTasksCollapsed = () => {
    setTasksCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(
          "octop:wb-tasks-collapsed",
          next ? "1" : "0",
        );
      } catch {
        /* storage optional */
      }
      return next;
    });
  };
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<
    | { mode: "create"; assignThreadId?: string }
    | { mode: "editIcon"; id: string }
    | { mode: "github" }
    | null
  >(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectIconDraft, setProjectIconDraft] = useState("📁");
  const [githubRefDraft, setGithubRefDraft] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [folderModal, setFolderModal] = useState<{ projectId: string } | null>(
    null,
  );
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [inlineRename, setInlineRename] = useState<{
    type: "project" | "folder";
    id: string;
  } | null>(null);
  const [inlineNameDraft, setInlineNameDraft] = useState("");
  const [pendingAssignment, setPendingAssignment] = useState<{
    projectId: string | null;
    folderId: string | null;
  } | null>(null);
  const [codeBrowserProjectId, setCodeBrowserProjectId] = useState<
    string | null
  >(null);
  const [shareDialogProject, setShareDialogProject] =
    useState<WorkbenchProject | null>(null);
  const [contextDialogProject, setContextDialogProject] =
    useState<WorkbenchProject | null>(null);
  const [runsDialogProject, setRunsDialogProject] =
    useState<WorkbenchProject | null>(null);
  const [knowledgeProject, setKnowledgeProject] =
    useState<WorkbenchProject | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [projectKnowledgeIds, setProjectKnowledgeIds] = useState<string[]>([]);
  const [projectKnowledgeLoading, setProjectKnowledgeLoading] = useState(false);
  const [projectKnowledgeLoadFailed, setProjectKnowledgeLoadFailed] =
    useState(false);
  const [projectKnowledgeSaving, setProjectKnowledgeSaving] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [availableModels, setAvailableModels] = useState<ResolvedModel[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelProviderMenuOpen, setModelProviderMenuOpen] = useState(false);
  const [modelPickerProviderId, setModelPickerProviderId] = useState<
    number | null
  >(null);
  const [preferredModel, setPreferredModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reasoningMode, setReasoningMode] = useState<
    "auto" | "enabled" | "disabled"
  >("auto");
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  const [directAcpRunner, setDirectAcpRunner] = useState<string | null>(null);
  const [acpRunners, setAcpRunners] = useState<Record<string, ACPRunnerConfig>>(
    {},
  );
  const [threadModelSelections, setThreadModelSelections] = useState<
    Record<string, string | null>
  >({});
  const modelPatchQueue = useRef(Promise.resolve());
  const modelPatchVersion = useRef(0);
  const modelSelectionTouched = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [platformOpen, setPlatformOpen] = useState(false);
  const [platformFrameReady, setPlatformFrameReady] = useState(false);
  const [platformSettingsOpen, setPlatformSettingsOpen] = useState(false);
  const [platformItems, setPlatformItems] = useState<CreationItem[]>([]);
  const [projectPreviewUrls, setProjectPreviewUrls] = useState<
    Record<string, string>
  >({});
  const [projectLaunchStatuses, setProjectLaunchStatuses] = useState<
    Record<string, ProjectLaunchStatus>
  >({});
  const [launchingProjectId, setLaunchingProjectId] = useState<string | null>(
    null,
  );
  const [platformCatalogError, setPlatformCatalogError] = useState(false);
  const [selectedPlatformId, setSelectedPlatformId] = useState("app:planet");
  const [platformUrl, setPlatformUrl] = useState(initialPlatformUrl);
  const [platformDraft, setPlatformDraft] = useState(initialPlatformUrl);
  const taskEpoch = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { preference, setPreference, skin, setSkin } = useTheme();
  const themeArtwork = VISUAL_SKINS.find((definition) => definition.id === skin)
    ?.image;
  const themeArtworkStyle = themeArtwork
    ? ({ "--wb-theme-art": `url("${themeArtwork}")` } as CSSProperties)
    : undefined;
  const { i18n, t } = useTranslation();
  const currentLocale = (i18n.language || "zh").startsWith("zh") ? "zh" : "en";
  const handleLocaleChange = async (lang: string) => {
    try {
      const prefs = await preferencesApi.setLocale(lang);
      await applyUserLocale(prefs.locale);
    } catch {
      /* keep current locale if the save fails */
    }
  };

  const chatVisibleAgents = useMemo(
    () => agents.filter((a) => a.chat_visible !== false),
    [agents],
  );
  const primary = useMemo(
    () => selectPrimaryAgent(chatVisibleAgents, preferredHostId),
    [chatVisibleAgents, preferredHostId],
  );
  // 输入框可直接切换对话 Agent：所有运行中且非桥接的 Agent（团队与专家都可单聊）。
  const agentOptions = useMemo(
    () => chatVisibleAgents.filter((a) => a.state === "running" && !a.bridge),
    [chatVisibleAgents],
  );
  const chooseAgent = (id: string) => {
    taskEpoch.current += 1;
    setPreferredHostId(id);
    try {
      window.localStorage.setItem("octop:workbench:primary-agent", id);
    } catch {
      /* browser storage may be disabled */
    }
  };

  // 项目 / 归档 / 删除：删除走服务端 API，归组与归档存本机。
  const assignmentByThread = useMemo(
    () =>
      new Map(
        assignments.map((assignment) => [assignment.thread_id, assignment]),
      ),
    [assignments],
  );
  // 项目层级：parent 挂在其父项目下；悬空 parent 视为顶级。
  const projectChildren = useMemo(() => {
    const ids = new Set(projects.map((item) => item.project_id));
    const map = new Map<string | null, WorkbenchProject[]>();
    for (const project of projects) {
      const key =
        project.parent_id && ids.has(project.parent_id)
          ? project.parent_id
          : null;
      const bucket = map.get(key) ?? [];
      bucket.push(project);
      map.set(key, bucket);
    }
    return map;
  }, [projects]);
  const projectSubtreeIds = (projectId: string): string[] => {
    const out: string[] = [projectId];
    const walk = (id: string) => {
      for (const child of projectChildren.get(id) ?? []) {
        out.push(child.project_id);
        walk(child.project_id);
      }
    };
    walk(projectId);
    return out;
  };
  const visibleThreads = useMemo(
    () =>
      threads
        .filter((t) => {
          if (archivedIds.includes(t.thread_id)) return false;
          const assignment = assignmentByThread.get(t.thread_id);
          if (activeFolder) return assignment?.folder_id === activeFolder;
          if (activeProject) {
            return (
              assignment?.project_id != null &&
              projectSubtreeIds(activeProject).includes(assignment.project_id)
            );
          }
          return true;
        })
        .sort(compareThreadRecency),
    [
      threads,
      archivedIds,
      activeProject,
      activeFolder,
      assignmentByThread,
      projectChildren,
    ],
  );
  const archivedThreads = useMemo(
    () =>
      threads
        .filter((t) => archivedIds.includes(t.thread_id))
        .sort(compareThreadRecency),
    [threads, archivedIds],
  );
  // 同一会话两处挂载：项目/文件夹子树（关系）+ 最近列表（时间），数据同源。
  const threadsByBucket = useMemo(() => {
    const map = new Map<string, OctopThread[]>();
    const threadById = new Map(threads.map((item) => [item.thread_id, item]));
    for (const assignment of assignments) {
      if (!assignment.project_id) continue;
      const thread = threadById.get(assignment.thread_id);
      if (!thread || archivedIds.includes(thread.thread_id)) continue;
      const key = `${assignment.project_id}:${assignment.folder_id ?? ""}`;
      const bucket = map.get(key) ?? [];
      bucket.push(thread);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) bucket.sort(compareThreadRecency);
    return map;
  }, [threads, assignments, archivedIds]);
  const projectBucket = (projectId: string, folderId: string | null) =>
    threadsByBucket.get(`${projectId}:${folderId ?? ""}`) ?? [];
  const createProject = async (
    name: string,
    icon: string,
    assignThreadId?: string,
  ) => {
    const created = await workbenchApi.createProject(name, icon);
    setProjects((prev) => [...prev, created]);
    if (assignThreadId)
      await setThreadAssignment(assignThreadId, created.project_id, null);
  };
  const updateProject = async (id: string, name: string, icon: string) => {
    const updated = await workbenchApi.updateProject(id, name, icon);
    setProjects((prev) =>
      prev.map((project) => (project.project_id === id ? updated : project)),
    );
  };
  const removeProject = async (id: string) => {
    await workbenchApi.deleteProject(id);
    setProjects((prev) => prev.filter((project) => project.project_id !== id));
    setFolders((prev) => prev.filter((folder) => folder.project_id !== id));
    setRecycledFolders((prev) =>
      prev.filter((folder) => folder.project_id !== id),
    );
    setAssignments((prev) =>
      prev.filter((assignment) => assignment.project_id !== id),
    );
    if (activeProject === id) {
      setActiveProject(null);
      setActiveFolder(null);
    }
  };
  const setThreadAssignment = async (
    threadId: string,
    projectId: string | null,
    folderId: string | null,
  ) => {
    const updated = await workbenchApi.assignThread(
      threadId,
      projectId,
      folderId,
    );
    setAssignments((prev) => [
      ...prev.filter((assignment) => assignment.thread_id !== threadId),
      updated,
    ]);
  };
  const createFolder = async (projectId: string, name: string) => {
    const created = await workbenchApi.createFolder(projectId, name);
    setFolders((prev) => [...prev, created]);
  };
  const renameFolder = async (folderId: string, name: string) => {
    const updated = await workbenchApi.renameFolder(folderId, name);
    setFolders((prev) =>
      prev.map((folder) => (folder.folder_id === folderId ? updated : folder)),
    );
  };
  const removeFolder = async (folderId: string) => {
    await workbenchApi.deleteFolder(folderId);
    const removed = folders.find((folder) => folder.folder_id === folderId);
    setFolders((prev) =>
      prev.filter((folder) => folder.folder_id !== folderId),
    );
    if (removed) setRecycledFolders((prev) => [removed, ...prev]);
    if (activeFolder === folderId) setActiveFolder(null);
  };
  const restoreFolder = async (folderId: string) => {
    await workbenchApi.restoreFolder(folderId);
    const restored = recycledFolders.find(
      (folder) => folder.folder_id === folderId,
    );
    if (restored) setFolders((prev) => [...prev, restored]);
    setRecycledFolders((prev) =>
      prev.filter((folder) => folder.folder_id !== folderId),
    );
  };
  const toggleArchiveThread = (threadId: string) => {
    const next = archivedIds.includes(threadId)
      ? archivedIds.filter((x) => x !== threadId)
      : [...archivedIds, threadId];
    setArchivedIds(next);
    saveLocalJson(archivedStorageKey(agentId), next);
  };
  const handleDeleteThread = (thread: OctopThread) => {
    if (!agentId) return;
    confirmDeleteConversation(i18n.t as TFunction, async (compact) => {
      const ok = await deleteConversation(
        agentId,
        thread.thread_id,
        compact,
        i18n.t as TFunction,
      );
      if (!ok) return;
      setThreads((prev) =>
        prev.filter((t) => t.thread_id !== thread.thread_id),
      );
      if (activeThread === thread.thread_id) {
        taskEpoch.current += 1;
        setActiveThread(null);
        setInput("");
      }
    });
  };
  const taskMenuFor = (thread: OctopThread) => ({
    items: [
      {
        key: "move",
        label: t("workbench.home.projects.projectMenu"),
        children: [
          { key: "move:none", label: t("workbench.home.projects.unfiled") },
          ...projects.map((p) => ({
            key: "move:" + p.project_id,
            label: p.name,
            children: [
              {
                key: `move:${p.project_id}:root`,
                label: t("workbench.home.projects.projectRoot"),
              },
              ...folders
                .filter((folder) => folder.project_id === p.project_id)
                .map((folder) => ({
                  key: `move:${p.project_id}:${folder.folder_id}`,
                  label: folder.name,
                })),
            ],
          })),
          { type: "divider" as const },
          { key: "move:new", label: "新建项目…" },
        ],
      },
      {
        key: "archive",
        label: archivedIds.includes(thread.thread_id) ? "取消归档" : "归档",
      },
      { type: "divider" as const },
      { key: "delete", label: "删除", danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "archive") {
        toggleArchiveThread(thread.thread_id);
        return;
      }
      if (key === "delete") {
        handleDeleteThread(thread);
        return;
      }
      if (key === "move:new") {
        setProjectNameDraft("");
        setProjectModal({ mode: "create", assignThreadId: thread.thread_id });
        return;
      }
      if (key.startsWith("move:")) {
        const [, projectId, folderId] = key.split(":");
        void setThreadAssignment(
          thread.thread_id,
          projectId === "none" ? null : projectId,
          folderId === "root" || projectId === "none" ? null : folderId || null,
        ).catch(() => setError(t("workbench.home.projects.moveFailed")));
      }
    },
  });
  const submitProjectModal = () => {
    const name = projectNameDraft.trim();
    if (!projectModal) return;
    if (projectModal.mode === "github") {
      const ref = githubRefDraft.trim();
      if (!ref) return;
      setGithubBusy(true);
      workbenchApi
        .importFromGithub(ref)
        .then((created) =>
          setProjects((prev) =>
            prev.some((item) => item.project_id === created.project_id)
              ? prev
              : [...prev, created],
          ),
        )
        .catch(() => setError(t("workbench.home.projects.githubImportFailed")))
        .finally(() => {
          setGithubBusy(false);
          setProjectModal(null);
        });
      return;
    }
    let save: Promise<void>;
    if (projectModal.mode === "create") {
      if (!name) return;
      save = createProject(name, projectIconDraft, projectModal.assignThreadId);
    } else {
      const project = projects.find(
        (item) => item.project_id === projectModal.id,
      );
      if (!project) return;
      save = updateProject(project.project_id, project.name, projectIconDraft);
    }
    void save
      .then(() => setProjectModal(null))
      .catch(() => setError(t("workbench.home.projects.saveProjectFailed")));
  };

  const openCreateProject = () => {
    setProjectNameDraft("");
    setProjectIconDraft("📁");
    setProjectModal({ mode: "create" });
  };

  const runProjectMenu = (key: string, project: WorkbenchProject) => {
    if (key === "details")
      navigate(`/projects/${encodeURIComponent(project.project_id)}`);
    else if (key === "task") newTaskInProject(project.project_id);
    else if (key === "share") setShareDialogProject(project);
    else if (key === "context") setContextDialogProject(project);
    else if (key === "run-history") setRunsDialogProject(project);
    else if (key === "folder") {
      setFolderNameDraft("");
      setFolderModal({ projectId: project.project_id });
    } else if (key === "knowledge") {
      setKnowledgeProject(project);
      setProjectKnowledgeIds(project.knowledge_base_ids || []);
      setProjectKnowledgeLoadFailed(false);
      setProjectKnowledgeLoading(true);
      void knowledgeBasesApi
        .list()
        .then(setKnowledgeBases)
        .catch(() => {
          setKnowledgeBases([]);
          setProjectKnowledgeLoadFailed(true);
          setError(t("workbench.home.projects.knowledgeLoadFailed"));
        })
        .finally(() => setProjectKnowledgeLoading(false));
    } else if (key === "code") setCodeBrowserProjectId(project.project_id);
    else if (key === "openGithub") {
      if (project.external_url)
        window.open(project.external_url, "_blank", "noopener,noreferrer");
    } else if (key === "rename")
      startInlineRename("project", project.project_id, project.name);
    else if (key === "icon") {
      setProjectIconDraft(project.icon);
      setProjectNameDraft("");
      setProjectModal({ mode: "editIcon", id: project.project_id });
    } else if (key === "delete") {
      Modal.confirm({
        title: t("workbench.home.projects.deleteProjectTitle", {
          name: project.name,
        }),
        content: t("workbench.home.projects.deleteProjectHint"),
        okText: t("workbench.home.projects.delete"),
        cancelText: t("workbench.home.projects.cancel"),
        okButtonProps: { danger: true },
        onOk: () =>
          removeProject(project.project_id).catch(() =>
            setError(t("workbench.home.projects.deleteProjectFailed")),
          ),
      });
    }
  };

  const moveProjectUnder = async (
    project: WorkbenchProject,
    parentId: string | null,
  ) => {
    try {
      const updated = await workbenchApi.updateProject(
        project.project_id,
        project.name,
        project.icon,
        parentId,
      );
      setProjects((prev) =>
        prev.map((item) =>
          item.project_id === updated.project_id ? updated : item,
        ),
      );
      if (
        activeProject &&
        !projectSubtreeIds(activeProject).includes(activeProject)
      ) {
        setActiveProject(null);
        setActiveFolder(null);
      }
    } catch {
      setError(t("workbench.home.projects.saveProjectFailed"));
    }
  };

  const projectMenu = (project: WorkbenchProject) => ({
    items: [
      { key: "details", label: t("projectDetailsPage.title") },
      { key: "task", label: t("workbench.home.projects.newTask") },
      { key: "folder", label: t("workbench.home.projects.newFolder") },
      ...(project.code_enabled
        ? [{ key: "code", label: t("workbench.home.projects.viewCode") }]
        : []),
      ...(project.external_url
        ? [
            {
              key: "openGithub",
              label: t("workbench.home.projects.openGithub"),
            },
            { type: "divider" as const },
          ]
        : []),
      { type: "divider" as const },
      { key: "share", label: t("workbench.home.projects.shareProject") },
      {
        key: "knowledge",
        label: t("workbench.home.projects.manageKnowledge"),
      },
      {
        key: "context",
        label: t("workbench.home.projects.editContext"),
      },
      {
        key: "run-history",
        label: t("workbench.home.projects.runHistory"),
      },
      { key: "rename", label: t("workbench.home.projects.editProject") },
      { key: "icon", label: t("workbench.home.projects.editProjectIcon") },
      {
        key: "move",
        label: t("workbench.home.projects.moveProject"),
        children: [
          {
            key: "move-root",
            label: t("workbench.home.projects.moveProjectRoot"),
          },
          ...projects
            .filter(
              (candidate) =>
                candidate.project_id !== project.project_id &&
                !projectSubtreeIds(project.project_id).includes(
                  candidate.project_id,
                ),
            )
            .map((candidate) => ({
              key: `under:${candidate.project_id}`,
              label: t("workbench.home.projects.moveProjectUnder", {
                name: candidate.name,
              }),
            })),
        ],
      },
      { type: "divider" as const },
      {
        key: "delete",
        label: t("workbench.home.projects.deleteProject"),
        danger: true,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "move-root") {
        void moveProjectUnder(project, null);
        return;
      }
      if (key.startsWith("under:")) {
        void moveProjectUnder(project, key.slice(6));
        return;
      }
      runProjectMenu(key, project);
    },
  });
  const renderTaskRow = (thread: OctopThread) => (
    <div
      className={
        "wb-task-row" + (activeThread === thread.thread_id ? " is-current" : "")
      }
      key={thread.thread_id}
    >
      <button
        type="button"
        onClick={() => selectThread(thread.thread_id)}
        className="wb-task-item"
      >
        <MessageSquareText size={15} />
        <span>{thread.title || "新的对话"}</span>
        <time>{formatTime(thread.last_active)}</time>
      </button>
      <Dropdown
        trigger={["click"]}
        placement="bottomLeft"
        overlayClassName="wb-theme-popup"
        menu={taskMenuFor(thread)}
      >
        <button type="button" className="wb-task-more" aria-label="任务操作">
          <Ellipsis size={14} />
        </button>
      </Dropdown>
    </div>
  );
  const renderProjectNode = (project: WorkbenchProject, depth: number) => (
    <div
      className="wb-project-group"
      key={project.project_id}
      style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
    >
      <div
        className={
          "wb-project-row" +
          (inlineRename?.type === "project" &&
          inlineRename.id === project.project_id
            ? " is-editing"
            : "")
        }
      >
        {inlineRename?.type === "project" &&
        inlineRename.id === project.project_id ? (
          <div className="wb-nav-item wb-project-item wb-project-inline-edit">
            <span className="wb-project-icon" aria-hidden>
              {project.icon}
            </span>
            <input
              aria-label={t("workbench.home.projects.editProject")}
              autoFocus
              maxLength={80}
              value={inlineNameDraft}
              onChange={(event) => setInlineNameDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={() => setInlineRename(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveInlineRename();
                }
                if (event.key === "Escape") {
                  setInlineRename(null);
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className={
              "wb-nav-item" +
              (activeProject === project.project_id && activeFolder === null
                ? " is-active"
                : "")
            }
            onClick={() => {
              setActiveProject(project.project_id);
              setActiveFolder(null);
              if (!activeThread)
                setPendingAssignment({
                  projectId: project.project_id,
                  folderId: null,
                });
            }}
          >
            {project.icon && project.icon !== "📁" ? (
              <span className="wb-project-icon" aria-hidden>
                {project.icon}
              </span>
            ) : (
              <Folder size={15} className="wb-project-glyph" />
            )}
            <span>{project.name}</span>
          </button>
        )}
        <span className="wb-project-actions">
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            overlayClassName="wb-theme-popup"
            menu={projectMenu(project)}
          >
            <button
              type="button"
              aria-label={t("workbench.home.projects.projectActionsNamed", {
                name: project.name,
              })}
            >
              <Ellipsis size={14} />
            </button>
          </Dropdown>
        </span>
      </div>
      {projectBucket(project.project_id, null).map(renderTaskRow)}
      {folders
        .filter((folder) => folder.project_id === project.project_id)
        .map((folder) => (
          <Fragment key={folder.folder_id}>
            <div
              className={
                "wb-project-folder-row" +
                (inlineRename?.type === "folder" &&
                inlineRename.id === folder.folder_id
                  ? " is-editing"
                  : "")
              }
            >
              <button
                type="button"
                className={
                  "wb-project-folder-toggle" +
                  (collapsedFolderIds.has(folder.folder_id)
                    ? " is-collapsed"
                    : "")
                }
                aria-label={t(
                  collapsedFolderIds.has(folder.folder_id)
                    ? "workbench.home.projects.expandFolder"
                    : "workbench.home.projects.collapseFolder",
                  { name: folder.name },
                )}
                aria-expanded={!collapsedFolderIds.has(folder.folder_id)}
                aria-controls={`wb-folder-content-${folder.folder_id}`}
                onClick={() =>
                  setCollapsedFolderIds((previous) => {
                    const next = new Set(previous);
                    if (next.has(folder.folder_id))
                      next.delete(folder.folder_id);
                    else next.add(folder.folder_id);
                    return next;
                  })
                }
              >
                <ChevronDown size={12} />
              </button>
              {inlineRename?.type === "folder" &&
              inlineRename.id === folder.folder_id ? (
                <div className="wb-nav-item wb-project-inline-edit">
                  <Folder size={14} />
                  <input
                    aria-label={t("workbench.home.projects.renameFolder")}
                    autoFocus
                    maxLength={64}
                    value={inlineNameDraft}
                    onChange={(event) => setInlineNameDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setInlineRename(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveInlineRename();
                      }
                      if (event.key === "Escape") {
                        setInlineRename(null);
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={
                    "wb-nav-item" +
                    (activeFolder === folder.folder_id ? " is-active" : "")
                  }
                  onClick={() => {
                    setActiveProject(project.project_id);
                    setActiveFolder(folder.folder_id);
                    if (!activeThread)
                      setPendingAssignment({
                        projectId: project.project_id,
                        folderId: folder.folder_id,
                      });
                  }}
                >
                  <Folder size={14} />
                  <span>{folder.name}</span>
                  <small>
                    {
                      assignments.filter(
                        (item) => item.folder_id === folder.folder_id,
                      ).length
                    }
                  </small>
                </button>
              )}
              <span className="wb-project-actions">
                <button
                  type="button"
                  aria-label={t("workbench.home.projects.newFolderTask")}
                  title={t("workbench.home.projects.newFolderTask")}
                  onClick={() =>
                    newTaskInProject(project.project_id, folder.folder_id)
                  }
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  aria-label={t("workbench.home.projects.renameFolder")}
                  title={t("workbench.home.projects.renameFolder")}
                  onClick={() =>
                    startInlineRename("folder", folder.folder_id, folder.name)
                  }
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  onClick={() =>
                    Modal.confirm({
                      title: t("workbench.home.projects.recycleFolderTitle", {
                        name: folder.name,
                      }),
                      content: t("workbench.home.projects.recycleFolderHint"),
                      okText: t("workbench.home.projects.moveToRecycleBin"),
                      cancelText: t("workbench.home.projects.cancel"),
                      okButtonProps: { danger: true },
                      onOk: () =>
                        removeFolder(folder.folder_id).catch(() =>
                          setError(
                            t("workbench.home.projects.deleteFolderFailed"),
                          ),
                        ),
                    })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            <div
              id={`wb-folder-content-${folder.folder_id}`}
              className="wb-project-folder-content"
              hidden={collapsedFolderIds.has(folder.folder_id)}
            >
              {projectBucket(project.project_id, folder.folder_id).map(
                renderTaskRow,
              )}
            </div>
          </Fragment>
        ))}
      {(projectChildren.get(project.project_id) ?? []).map((child) =>
        renderProjectNode(child, depth + 1),
      )}
    </div>
  );
  const agentId = primary?.agent_id || null;
  const activeThreadRow = threads.find(
    (thread) => thread.thread_id === activeThread,
  );
  const activeAcpRunner = activeThread
    ? activeThreadRow?.acp_runner || null
    : directAcpRunner;
  const usingAcpRunner = Boolean(activeAcpRunner);
  const activeAcpRunnerLabel = activeAcpRunner
    ? t(`acp.runner_${activeAcpRunner}`, activeAcpRunner)
    : null;
  const canUseAcpRunner = Boolean(
    primary && !blocksAcpOutboundFromConfig(primary.config ?? null),
  );
  const activeAcpDefaultModel = activeAcpRunner
    ? acpRunners[activeAcpRunner]?.default_model || null
    : null;
  const activeThreadModel =
    threads.find((thread) => thread.thread_id === activeThread)?.model_ref ??
    null;
  useEffect(() => {
    let cancelled = false;
    void preferencesApi
      .get()
      .then((preferences) => {
        if (!cancelled) setPreferredModel(preferences.preferred_model || null);
      })
      .catch(() => {
        if (!cancelled) setPreferredModel(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    setModelsReady(false);
    if (!agentId) {
      setAvailableModels([]);
      setModelsReady(true);
      return;
    }
    let cancelled = false;
    const loadModels = () => {
      void providerApi
        .listResolvedModels(agentId)
        .then((models) => {
          if (!cancelled) setAvailableModels(models);
        })
        .catch(() => {
          if (!cancelled) setAvailableModels([]);
        })
        .finally(() => {
          if (!cancelled) setModelsReady(true);
        });
    };
    loadModels();
    window.addEventListener("focus", loadModels);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadModels);
    };
  }, [agentId, location.pathname]);
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void acpApi
      .getConfig(agentId)
      .then((config) => {
        if (cancelled) return;
        setAcpRunners(config.runners || {});
      })
      .catch(() => {
        if (!cancelled) {
          setAcpRunners({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);
  useEffect(() => {
    modelSelectionTouched.current = false;
  }, [agentId, activeThread]);
  useEffect(() => {
    if (!activeThread && modelSelectionTouched.current) return;
    if (usingAcpRunner) {
      setSelectedModel(null);
      return;
    }
    const requestedModel =
      activeThread &&
      Object.prototype.hasOwnProperty.call(threadModelSelections, activeThread)
        ? threadModelSelections[activeThread]
        : activeThreadModel || preferredModel;
    const isAvailable = (
      candidate: string | null | undefined,
    ): candidate is string =>
      Boolean(
        candidate &&
          availableModels.some(
            (model) =>
              ("value" in model ? model.value : modelOptionValue(model)) ===
              candidate,
          ),
      );
    setSelectedModel(
      isAvailable(requestedModel)
        ? requestedModel
        : isAvailable(preferredModel)
        ? preferredModel
        : null,
    );
  }, [
    agentId,
    usingAcpRunner,
    activeThread,
    activeThreadModel,
    preferredModel,
    availableModels,
    threadModelSelections,
  ]);
  const selectedModelOption = availableModels.find(
    (model) => modelOptionValue(model) === selectedModel,
  );
  const selectedModelLabel = selectedModelOption
    ? modelOptionLabel(selectedModelOption)
    : null;
  const selectedReasoningCapability = availableModels.find(
    (model) => modelOptionValue(model) === selectedModel,
  )?.reasoning_config;
  const effectiveReasoningMode = activeThread
    ? activeThreadRow?.reasoning_mode ??
      selectedReasoningCapability?.default_mode ??
      reasoningMode
    : reasoningMode;
  const effectiveReasoningEffort = activeThread
    ? activeThreadRow?.reasoning_effort ??
      selectedReasoningCapability?.default_effort ??
      reasoningEffort
    : reasoningEffort;
  const showReasoningToggle = Boolean(
    selectedReasoningCapability?.toggle &&
      selectedReasoningCapability.adapter !== "status_only",
  );
  const reasoningToggleActive =
    effectiveReasoningMode === "enabled" ||
    (effectiveReasoningMode === "auto" &&
      selectedReasoningCapability?.default_mode === "enabled");
  const reasoningEfforts = selectedReasoningCapability?.efforts ?? [];
  const showReasoningControls =
    showReasoningToggle || reasoningEfforts.length > 0;
  const selectedReasoningEffort =
    [
      effectiveReasoningEffort,
      selectedReasoningCapability?.default_effort,
    ].find((effort) => effort && reasoningEfforts.includes(effort)) ??
    reasoningEfforts[0] ??
    null;
  const reasoningEffortIndex = Math.max(
    0,
    reasoningEfforts.indexOf(selectedReasoningEffort ?? ""),
  );
  const reasoningSliderValue =
    reasoningEfforts.length > 0
      ? reasoningEffortIndex
      : reasoningToggleActive
      ? 1
      : 0;
  const reasoningSliderLabel =
    reasoningEfforts.length === 0
      ? t(
          reasoningToggleActive
            ? "chat.reasoningEnabled"
            : "chat.reasoningDisabled",
          reasoningToggleActive ? "开启" : "关闭",
        )
      : selectedReasoningCapability?.effort_type === "token_budget"
      ? t("chat.reasoningTokenBudget", {
          value: Number(selectedReasoningEffort).toLocaleString(),
        })
      : t(
          `chat.reasoningEffortValues.${selectedReasoningEffort}`,
          selectedReasoningEffort ?? "",
        );
  const modelProviderGroups = Array.from(
    availableModels.reduce((groups, model) => {
      const group = groups.get(model.provider_id) ?? {
        id: model.provider_id,
        name: model.provider_name,
        models: [],
      };
      group.models.push(model);
      groups.set(model.provider_id, group);
      return groups;
    }, new Map<number, { id: number; name: string; models: ResolvedModel[] }>()),
  ).map(([, group]) => group);
  const selectedModelProviderId = availableModels.find(
    (model) => modelOptionValue(model) === selectedModel,
  )?.provider_id;
  const selectedProviderGroup =
    modelProviderGroups.find((group) => group.id === modelPickerProviderId) ??
    modelProviderGroups.find((group) => group.id === selectedModelProviderId) ??
    modelProviderGroups[0];
  const visibleModelOptions = selectedProviderGroup?.models ?? [];
  const modelMenuItems = [
    { key: "auto", label: t("chat.modelAuto", "自动") },
    ...visibleModelOptions.map((model) => ({
      key: modelOptionValue(model),
      label: modelOptionLabel(model),
    })),
    ...(!modelsReady || visibleModelOptions.length > 0
      ? []
      : [
          {
            key: "empty",
            label: t("chat.noModelsAvailable", "当前 Agent 暂无可用模型"),
            disabled: true,
          },
        ]),
  ];
  const handleModelMenu: (info: { key: string }) => void = ({ key }) => {
    if (!modelsReady || key === "empty") return;
    const model = key === "auto" ? null : key;
    const capability = availableModels.find(
      (item) => modelOptionValue(item) === model,
    )?.reasoning_config;
    const nextReasoningMode = capability?.default_mode ?? "auto";
    const nextReasoningEffort = capability?.default_effort ?? null;
    setReasoningMode(nextReasoningMode);
    setReasoningEffort(nextReasoningEffort);
    modelSelectionTouched.current = true;
    setSelectedModel(model);
    if (model) {
      const providerId = availableModels.find(
        (item) => modelOptionValue(item) === model,
      )?.provider_id;
      if (providerId !== undefined) setModelPickerProviderId(providerId);
    }
    if (activeThread && agentId) {
      setThreadModelSelections((previous) => ({
        ...previous,
        [activeThread]: model,
      }));
      setThreads((previous) =>
        previous.map((thread) =>
          thread.thread_id === activeThread
            ? {
                ...thread,
                model_ref: model,
                reasoning_mode: nextReasoningMode,
                reasoning_effort: nextReasoningEffort,
              }
            : thread,
        ),
      );
      const version = ++modelPatchVersion.current;
      modelPatchQueue.current = modelPatchQueue.current
        .then(() =>
          octopThreadsApi.patch(agentId, activeThread, {
            model_ref: model,
            reasoning_mode: nextReasoningMode,
            reasoning_effort: nextReasoningEffort,
          }),
        )
        .then(() => undefined)
        .catch(() => {
          if (version === modelPatchVersion.current) {
            setError(t("chat.modelSaveFailed", "模型设置保存失败"));
          }
        });
    }
  };
  const handleReasoningToggle = (enabled?: boolean) => {
    const nextMode = enabled ?? !reasoningToggleActive ? "enabled" : "disabled";
    setReasoningMode(nextMode);
    if (activeThread && agentId) {
      setThreads((previous) =>
        previous.map((thread) =>
          thread.thread_id === activeThread
            ? { ...thread, reasoning_mode: nextMode }
            : thread,
        ),
      );
      const version = ++modelPatchVersion.current;
      modelPatchQueue.current = modelPatchQueue.current
        .then(() =>
          octopThreadsApi.patch(agentId, activeThread, {
            reasoning_mode: nextMode,
          }),
        )
        .then(() => undefined)
        .catch(() => {
          if (version === modelPatchVersion.current) {
            setError(t("chat.reasoningSaveFailed", "思考设置保存失败"));
          }
        });
    }
  };
  const handleReasoningEffortChange = (effort: string) => {
    setReasoningMode("enabled");
    setReasoningEffort(effort);
    if (activeThread && agentId) {
      setThreads((previous) =>
        previous.map((thread) =>
          thread.thread_id === activeThread
            ? { ...thread, reasoning_mode: "enabled", reasoning_effort: effort }
            : thread,
        ),
      );
      const version = ++modelPatchVersion.current;
      modelPatchQueue.current = modelPatchQueue.current
        .then(() =>
          octopThreadsApi.patch(agentId, activeThread, {
            reasoning_mode: "enabled",
            reasoning_effort: effort,
          }),
        )
        .then(() => undefined)
        .catch(() => {
          if (version === modelPatchVersion.current) {
            setError(t("chat.reasoningSaveFailed", "思考设置保存失败"));
          }
        });
    }
  };
  const teamReady = canDelegate(primary);
  const {
    messages,
    isStreaming,
    liveSpeakers,
    historyLoading,
    historyError,
    sendMessage,
    cancelStream,
    loadHistory,
  } = useChat(activeThread, agentId, primary?.kind === "team");
  // Manus 式输入框能力：本地文件附件 + 语音输入，复用聊天页同一套管线。
  const {
    items: uploadItems,
    attachments,
    uploading,
    fileInputRef,
    handleFileChange,
    handlePaste,
    removeUpload,
    retryUpload,
    clearAttachments,
  } = useChatAttachments(agentId);
  const voiceInput = useVoiceInput({
    onText: (text) => setInput((prev) => (prev ? prev + text : text)),
  });
  const sttAvailable = isSttAvailable();
  const visibleMessages = useMemo(
    () => visibleConversationMessages(messages, agentId),
    [messages, agentId],
  );
  const visibleMessageGroups = useMemo(
    () =>
      groupConsecutiveAssistantMessages(visibleMessages, agentId ?? undefined),
    [visibleMessages, agentId],
  );
  const hasPendingApproval = messages.some(
    (m) => m.hitlData?.status === "pending",
  );
  const platformEntries = useMemo(
    () => [
      ...BUILT_IN_CREATIONS.map((item) => ({
        id: `app:${item.id}`,
        itemId: null,
        name: t(item.titleKey),
        description: t(item.descriptionKey),
        url: item.url
          ? new URL(item.url, window.location.origin).toString()
          : null,
        thumb: item.thumb,
        launchable: false,
        builtIn: true,
      })),
      ...platformItems.map((item) => ({
        id: item.item_id,
        itemId: item.item_id,
        name: item.name,
        description: item.description,
        url: projectPreviewUrls[item.item_id] || item.url,
        thumb: item.thumbnail_url,
        launchable: isLaunchableProjectUrl(item.url),
        builtIn: false,
      })),
    ],
    [platformItems, projectPreviewUrls, t],
  );
  const selectedPlatform = platformEntries.find(
    (item) => item.id === selectedPlatformId,
  );
  const platformSrc = useMemo(() => {
    const selected =
      selectedPlatformId === "app:planet" ? platformUrl : selectedPlatform?.url;
    return selected
      ? resolvePrivatePlatformUrl(
          selected,
          window.location.hostname,
          window.location.protocol,
        )
      : null;
  }, [platformUrl, selectedPlatformId, selectedPlatform]);

  useEffect(() => {
    let cancelled = false;
    void request<MeUser>("/auth/me")
      .then((value) => {
        if (!cancelled) setUser(value);
      })
      .catch(() => {});
    void request<OctopAgent[]>("/agents")
      .then((value) => {
        if (!cancelled) setAgents(value);
      })
      .catch(() => {
        if (!cancelled) setError("无法加载 Agent 列表，请检查私有云服务。");
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!platformOpen) return;
    let cancelled = false;
    void creationsApi
      .list()
      .then((data) => {
        if (!cancelled) {
          setPlatformItems(data.items);
          setPlatformCatalogError(false);
          if (user?.role === "admin") {
            void Promise.all(
              data.items
                .filter(
                  (item) =>
                    item.kind === "service" && isLaunchableProjectUrl(item.url),
                )
                .map(async (item) => {
                  try {
                    const status = await creationsApi.launchStatus(
                      item.item_id,
                    );
                    setProjectLaunchStatuses((previous) => ({
                      ...previous,
                      [item.item_id]: status,
                    }));
                    if (status.status === "running" && status.url) {
                      setProjectPreviewUrls((previous) => ({
                        ...previous,
                        [item.item_id]: status.url!,
                      }));
                    } else {
                      setProjectPreviewUrls((previous) => {
                        const next = { ...previous };
                        delete next[item.item_id];
                        return next;
                      });
                    }
                  } catch {
                    // A launch profile can be absent on another Octop host.
                  }
                }),
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPlatformCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [platformOpen, user?.role]);

  useEffect(() => {
    setThreads([]);
    setActiveThread(null);
    if (!agentId) return;
    let cancelled = false;
    void octopThreadsApi
      .list(agentId, 30)
      .then((rows) => {
        if (!cancelled) {
          setThreads((current) =>
            rows.map((thread) => {
              const optimisticTitle = current.find(
                (item) => item.thread_id === thread.thread_id,
              )?.title;
              return thread.title || !optimisticTitle
                ? thread
                : { ...thread, title: optimisticTitle };
            }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError("暂时无法获取会话历史。");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // 项目与会话归属按账号同步；仅兼容导入旧浏览器保存的项目列表。
  useEffect(() => {
    setArchivedIds(loadLocalJson<string[]>(archivedStorageKey(agentId), []));
    setActiveProject(null);
    setActiveFolder(null);
    setShowArchived(false);
    setProjects([]);
    setFolders([]);
    setRecycledFolders([]);
    setAssignments([]);
    if (!agentId) return;
    let cancelled = false;
    void workbenchApi
      .get()
      .then(async (index) => {
        if (index.projects.length === 0) {
          const legacy = loadLocalJson<
            Array<{ name: string; threadIds?: string[] }>
          >(legacyProjectsStorageKey(agentId), []);
          if (legacy.length) {
            await workbenchApi.importLocalProjects(
              legacy.map((project) => ({
                name: project.name,
                thread_ids: project.threadIds || [],
              })),
            );
            const imported = await workbenchApi.get();
            if (!cancelled) {
              setProjects(imported.projects);
              setFolders(imported.folders);
              setRecycledFolders(imported.recycled_folders ?? []);
              setAssignments(imported.assignments);
            }
            return;
          }
        }
        if (!cancelled) {
          setProjects(index.projects);
          setFolders(index.folders);
          setRecycledFolders(index.recycled_folders ?? []);
          setAssignments(index.assignments);
        }
      })
      .catch(() => {
        if (!cancelled) setError("项目列表加载失败，请检查服务连接。");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    if (activeThread && agentId) void loadHistory(activeThread);
  }, [activeThread, agentId, loadHistory]);

  const activeThreadTitle = threads.find(
    (item) => item.thread_id === activeThread,
  )?.title;
  const hasActiveThread = threads.some(
    (item) => item.thread_id === activeThread,
  );
  useEffect(() => {
    if (
      !activeThread ||
      !agentId ||
      !hasActiveThread ||
      activeThreadTitle ||
      historyLoading
    )
      return;
    let cancelled = false;
    void (async () => {
      let offset = 0;
      let firstQuestion = "";
      while (!cancelled) {
        let page = await octopThreadsApi.history(agentId, activeThread, {
          limit: CHAT_HISTORY_PAGE_SIZE,
          offset,
        });
        while (page.history_loading && !cancelled) {
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              Math.max(
                500,
                Math.min(page.history_retry_after_ms ?? 1500, 5000),
              ),
            ),
          );
          if (cancelled) return;
          page = await octopThreadsApi.history(agentId, activeThread, {
            limit: CHAT_HISTORY_PAGE_SIZE,
            offset,
          });
        }
        const question = page.messages.find(
          (item) => item.role === "user" && typeof item.content === "string",
        );
        if (question && typeof question.content === "string") {
          firstQuestion = question.content;
        }
        if (!page.has_more) break;
        offset += page.limit ?? CHAT_HISTORY_PAGE_SIZE;
      }
      const title = clipThreadTitle(firstQuestion);
      if (!title || cancelled) return;
      await octopThreadsApi.rename(agentId, activeThread, title);
      if (cancelled) return;
      setThreads((current) =>
        current.map((item) =>
          item.thread_id === activeThread && !item.title
            ? { ...item, title }
            : item,
        ),
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    activeThread,
    activeThreadTitle,
    agentId,
    hasActiveThread,
    historyLoading,
  ]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, messages, isStreaming]);

  const newTask = () => {
    // Starting another task wins over an in-flight create-thread request.
    taskEpoch.current += 1;
    setPlatformOpen(false);
    setMobileNavOpen(false);
    setActiveThread(null);
    setPendingAssignment(
      activeProject
        ? { projectId: activeProject, folderId: activeFolder }
        : null,
    );
    setInput("");
    setError("");
    if (!isHomeRoute) navigate("/home");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const newTaskInProject = (
    projectId: string,
    folderId: string | null = null,
  ) => {
    setActiveProject(projectId);
    setActiveFolder(folderId);
    setPendingAssignment({ projectId, folderId });
    taskEpoch.current += 1;
    setPlatformOpen(false);
    setMobileNavOpen(false);
    setActiveThread(null);
    setInput("");
    setError("");
    if (!isHomeRoute) navigate("/home");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitFolderModal = () => {
    const name = folderNameDraft.trim();
    if (!name || !folderModal) return;
    void createFolder(folderModal.projectId, name)
      .then(() => setFolderModal(null))
      .catch(() => setError(t("workbench.home.projects.saveFolderFailed")));
  };

  const startInlineRename = (
    type: "project" | "folder",
    id: string,
    name: string,
  ) => {
    setInlineNameDraft(name);
    setInlineRename({ type, id });
  };
  const saveInlineRename = () => {
    const target = inlineRename;
    const name = inlineNameDraft.trim();
    if (!target) return;
    setInlineRename(null);
    if (!name) return;
    if (target.type === "project") {
      const project = projects.find((item) => item.project_id === target.id);
      if (!project || project.name === name) return;
      void updateProject(target.id, name, project.icon).catch(() =>
        setError(t("workbench.home.projects.saveProjectFailed")),
      );
      return;
    }
    const folder = folders.find((item) => item.folder_id === target.id);
    if (!folder || folder.name === name) return;
    void renameFolder(target.id, name).catch(() =>
      setError(t("workbench.home.projects.saveFolderFailed")),
    );
  };

  // 品牌标志只控制侧栏，不重置当前会话或切换右侧页面。
  const toggleSideCollapsed = () => {
    setSideCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(
          "octop:wb-side-collapsed",
          next ? "1" : "0",
        );
      } catch {
        /* storage optional */
      }
      return next;
    });
  };
  const handleBrandClick = () => {
    if (window.matchMedia?.("(max-width: 740px)").matches) {
      setMobileNavOpen(false);
      return;
    }
    toggleSideCollapsed();
  };
  const brandLabel = window.matchMedia?.("(max-width: 740px)").matches
    ? "关闭导航"
    : sideCollapsed
    ? "展开侧边栏"
    : "收起侧边栏";

  const selectThread = (threadId: string) => {
    taskEpoch.current += 1;
    setPlatformOpen(false);
    setMobileNavOpen(false);
    setError("");
    setActiveThread(threadId);
    if (!isHomeRoute) navigate("/home");
  };

  const navigateFromWorkbench = (path: string) => {
    setMobileNavOpen(false);
    closeSettings();
    setMoreOpen(false);
    // Star Planet is an independent surface, never carry its iframe to a feature route.
    setPlatformOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setMobileNavOpen(false);
    closeSettings();
    await authApi.logout();
    clearAuthToken();
    await applyGuestLocale();
    navigate("/login", { replace: true });
  };

  const chooseProjectAssignment = (
    projectId: string | null,
    folderId: string | null = null,
  ) => {
    if (activeThread) {
      void setThreadAssignment(activeThread, projectId, folderId).catch(() =>
        setError(t("workbench.home.projects.moveFailed")),
      );
    } else {
      setPendingAssignment({ projectId, folderId });
    }
    setActiveProject(projectId);
    setActiveFolder(folderId);
  };

  // Composer menu: attach files, pick a project, or open supporting resources.
  const plusMenuItems = [
    {
      key: "file",
      icon: <Paperclip size={15} />,
      label: t("workbench.home.projects.file"),
    },
    {
      key: "recent",
      label: t("workbench.home.projects.recentTasks"),
      children: threads.length
        ? threads.slice(0, 8).map((t) => ({
            key: "task:" + t.thread_id,
            label: t.title || "新的对话",
          }))
        : [
            {
              key: "recent-empty",
              label: t("workbench.home.projects.noConversations"),
              disabled: true,
            },
          ],
    },
    {
      key: "project",
      label: t("workbench.home.projects.projectMenu"),
      children: [
        { key: "project:none", label: t("workbench.home.projects.unfiled") },
        ...projects.map((project) => ({
          key: `project:${project.project_id}`,
          label: project.name,
          children: [
            {
              key: `project:${project.project_id}:root`,
              label: t("workbench.home.projects.projectRoot"),
            },
            ...folders
              .filter((folder) => folder.project_id === project.project_id)
              .map((folder) => ({
                key: `project:${project.project_id}:${folder.folder_id}`,
                label: folder.name,
              })),
          ],
        })),
      ],
    },
    { key: "kb", label: t("workbench.home.projects.knowledge") },
    { key: "skills", label: t("workbench.home.projects.skills") },
    { key: "create", label: t("workbench.home.projects.creations") },
  ];
  const handlePlusMenu: (info: { key: string }) => void = ({ key }) => {
    if (key === "file") {
      fileInputRef.current?.click();
      return;
    }
    if (key.startsWith("task:")) {
      selectThread(key.slice(5));
      return;
    }
    if (key.startsWith("project:")) {
      const [, projectId, folderId] = key.split(":");
      chooseProjectAssignment(
        projectId === "none" ? null : projectId,
        projectId === "none" || folderId === "root" ? null : folderId || null,
      );
      return;
    }
    if (key === "kb") navigate("/knowledge-bases");
    else if (key === "skills") navigate("/personalization");
    else if (key === "create") navigate("/creations");
  };

  // 输入框左下的 Agent 选择器：切换后消息发给选中的 Agent。
  const agentMenuItems = [
    ...(agentOptions.length
      ? agentOptions.map((a) => ({
          key: a.agent_id,
          label: (
            <span className="wb-agent-option">
              <ExpertAgentAvatar
                iconName={a.icon_name}
                iconUrl={a.icon_url}
                color={a.color}
                size={24}
              />
              <span>
                {(a.kind === "team" ? "★ " : "") + (a.name || a.agent_id)}
              </span>
            </span>
          ),
        }))
      : [{ key: "agent-empty", label: "没有运行中的 Agent", disabled: true }]),
    ...(canUseAcpRunner
      ? Object.entries(acpRunners)
          .filter(([, runner]) => runner.enabled)
          .map(([runnerName]) => ({
            key: `acp:${runnerName}`,
            label: t(`acp.runner_${runnerName}`, runnerName),
          }))
      : []),
  ];
  const handleAgentMenu: (info: { key: string }) => void = ({ key }) => {
    if (key.startsWith("acp:")) {
      const runnerName = key.slice(4);
      const defaultModel = acpRunners[runnerName]?.default_model || null;
      setDirectAcpRunner(runnerName);
      if (activeThread && agentId) {
        setThreads((items) =>
          items.map((thread) =>
            thread.thread_id === activeThread
              ? {
                  ...thread,
                  acp_runner: runnerName,
                  acp_model: defaultModel,
                }
              : thread,
          ),
        );
        void octopThreadsApi
          .patch(agentId, activeThread, {
            acp_runner: runnerName,
            acp_model: defaultModel,
          })
          .catch(() => setError(t("acp.directChatSaveFailed")));
        setSelectedModel(null);
      }
      return;
    }
    if (
      key &&
      key !== "agent-empty" &&
      (usingAcpRunner || key !== primary?.agent_id)
    ) {
      setDirectAcpRunner(null);
      if (activeThread && agentId) {
        setThreads((items) =>
          items.map((thread) =>
            thread.thread_id === activeThread
              ? { ...thread, acp_runner: null, acp_model: null }
              : thread,
          ),
        );
        void octopThreadsApi.patch(agentId, activeThread, {
          acp_runner: null,
          acp_model: null,
        });
      }
      chooseAgent(key);
    }
  };

  const send = async (provided?: string) => {
    const text = (provided ?? input).trim();
    if (
      (!text && attachments.length === 0) ||
      uploading ||
      !agentId ||
      sending ||
      isStreaming ||
      hasPendingApproval
    )
      return;
    const firstQuestionTitle = activeThread
      ? threads.find((item) => item.thread_id === activeThread)?.title || ""
      : clipThreadTitle(text || attachments[0]?.filename || "图片消息");
    const epoch = taskEpoch.current;
    setSending(true);
    setError("");
    try {
      let threadId = activeThread;
      let sessionKey = threadId || "";
      if (!threadId) {
        const created =
          usingAcpRunner && activeAcpRunner
            ? await octopThreadsApi.create(agentId, {
                acp_runner: activeAcpRunner,
                acp_model: activeAcpDefaultModel,
              })
            : await octopThreadsApi.create(agentId);
        if (epoch !== taskEpoch.current) return;
        threadId = created.thread_id;
        sessionKey = created.session_key;
        const now = Math.floor(Date.now() / 1000);
        setThreads((prev) => [
          {
            thread_id: created.thread_id,
            session_key: created.session_key,
            channel_type: "dashboard",
            title: firstQuestionTitle,
            last_active: now,
            created_at: now,
            model_ref: usingAcpRunner ? null : selectedModel,
            acp_runner: usingAcpRunner ? activeAcpRunner : null,
            acp_model: usingAcpRunner ? activeAcpDefaultModel : null,
            reasoning_mode: usingAcpRunner ? null : effectiveReasoningMode,
            reasoning_effort: usingAcpRunner ? null : effectiveReasoningEffort,
          },
          ...prev,
        ]);
        setThreadModelSelections((previous) => ({
          ...previous,
          [created.thread_id]: usingAcpRunner ? null : selectedModel,
        }));
        setActiveThread(threadId);
        if (pendingAssignment?.projectId) {
          await setThreadAssignment(
            threadId,
            pendingAssignment.projectId,
            pendingAssignment.folderId,
          );
        }
      }
      if (!threadId || epoch !== taskEpoch.current) return;
      // The existing Octop WebSocket store handles streaming and reconnection.
      // Do not dispatch worker messages directly from this surface.
      if (usingAcpRunner && activeAcpRunner) {
        sendMessage(
          text,
          sessionKey,
          agentId,
          attachments.length ? attachments : undefined,
          threadId,
          null,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          activeAcpRunner,
        );
      } else {
        const args = [
          text,
          sessionKey,
          agentId,
          attachments.length ? attachments : undefined,
          threadId,
          selectedModel,
        ] as const;
        if (selectedReasoningCapability) {
          sendMessage(
            ...args,
            undefined,
            undefined,
            undefined,
            undefined,
            effectiveReasoningMode,
            effectiveReasoningEffort,
          );
        } else {
          sendMessage(...args);
        }
      }
      setInput("");
      setPendingAssignment(null);
      clearAttachments();
      setThreads((prev) =>
        prev.map((t) =>
          t.thread_id === threadId
            ? {
                ...t,
                title: t.title || firstQuestionTitle,
                last_active: Math.floor(Date.now() / 1000),
              }
            : t,
        ),
      );
    } catch {
      setError("发送失败。请检查主 Agent 的运行状态，再重试。");
    } finally {
      setSending(false);
    }
  };

  const savePlatformUrl = () => {
    const next = resolvePrivatePlatformUrl(
      platformDraft,
      window.location.hostname,
      window.location.protocol,
    );
    if (!next) {
      setError(
        "平台地址必须是当前私有云主机的安全地址；HTTPS 工作台不能加载 HTTP 平台。",
      );
      return;
    }
    setPlatformUrl(next);
    setPlatformFrameReady(false);
    try {
      window.localStorage.setItem("octop:workbench:planet-url", next);
    } catch {
      /* storage optional */
    }
    setError("");
    setPlatformSettingsOpen(false);
  };

  const openPlatform = () => {
    setError("");
    setPlatformFrameReady(false);
    setPlatformOpen(true);
    setPlatformSettingsOpen(false);
  };
  const openPlatformEntry = async (entry: (typeof platformEntries)[number]) => {
    if (entry.launchable && entry.itemId) {
      if (
        !supportsLocalProjectPreview(
          window.location.hostname,
          window.location.protocol,
        )
      ) {
        setError(t("workbench.home.platforms.localPreviewOnly"));
        return;
      }
      if (user?.role !== "admin") {
        setError(t("workbench.home.platforms.previewFailed"));
        return;
      }
      setError("");
      setLaunchingProjectId(entry.itemId);
      try {
        const status = await creationsApi.startProject(entry.itemId);
        setProjectLaunchStatuses((previous) => ({
          ...previous,
          [entry.itemId!]: status,
        }));
        if (status.thumbnail_url) {
          setPlatformItems((previous) =>
            previous.map((item) =>
              item.item_id === entry.itemId
                ? { ...item, thumbnail_url: status.thumbnail_url }
                : item,
            ),
          );
        }
        if (status.status !== "running" || !status.url) {
          setProjectPreviewUrls((previous) => {
            const next = { ...previous };
            delete next[entry.itemId!];
            return next;
          });
          setError(
            status.logs
              ? `${t("workbench.home.platforms.previewFailed")} ${status.logs}`
              : t("workbench.home.platforms.previewFailed"),
          );
          return;
        }
        setProjectPreviewUrls((previous) => ({
          ...previous,
          [entry.itemId!]: status.url!,
        }));
        setSelectedPlatformId(entry.id);
        setPlatformFrameReady(false);
        setPlatformSettingsOpen(false);
        return;
      } catch {
        setError(t("workbench.home.platforms.previewFailed"));
        return;
      } finally {
        setLaunchingProjectId(null);
      }
    }
    if (!entry.url) {
      setSelectedPlatformId(entry.id);
      setPlatformFrameReady(false);
      setPlatformSettingsOpen(false);
      return;
    }
    const embeddedUrl =
      entry.id === "app:planet"
        ? resolvePrivatePlatformUrl(
            platformUrl,
            window.location.hostname,
            window.location.protocol,
          )
        : resolvePrivatePlatformUrl(
            entry.url,
            window.location.hostname,
            window.location.protocol,
          );
    if (embeddedUrl) {
      setSelectedPlatformId(entry.id);
      setPlatformFrameReady(false);
      setPlatformSettingsOpen(false);
      return;
    }
    try {
      const externalUrl = new URL(entry.url);
      if (
        !["http:", "https:"].includes(externalUrl.protocol) ||
        externalUrl.username ||
        externalUrl.password
      )
        return;
      window.open(externalUrl.toString(), "_blank", "noopener,noreferrer");
    } catch {
      /* invalid or unsafe URLs are not opened */
    }
  };
  const displayName = user?.display_name || user?.username || "用户";

  // 个人账户：设置弹窗打开时拉一次最新资料（头像/显示名），未编辑过时回填显示名。
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    void authApi
      .me()
      .then((next) => {
        if (!cancelled) {
          setUser(next);
          if (!nameDirtyRef.current) setNameDraft(next.display_name || "");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
  }, []);

  /** 内嵌分区页面请求离开（如专家卡片「对话」）：关闭弹窗并真实导航。 */
  const exitSettingsSection = useCallback(
    (to: string) => {
      closeSettings();
      if (to) navigate(to);
    },
    [closeSettings, navigate],
  );

  const handleAvatarIcon = async (icon: string | null) => {
    if (user) setUser({ ...user, avatar_icon: icon, avatar_url: null });
    try {
      const next = await authApi.setAvatarIcon(icon);
      setUser((prev) => (prev ? { ...prev, ...next } : prev));
    } catch (e) {
      message.error(apiErrorMessage(e, "头像保存失败，请重试"));
      throw e;
    }
  };
  const handleAvatarUpload = async (file: File) => {
    try {
      const result = await authApi.uploadAvatar(file);
      setUser((prev) =>
        prev ? { ...prev, avatar_url: result.avatar_url } : prev,
      );
    } catch (e) {
      message.error(apiErrorMessage(e, "头像上传失败，请重试"));
      throw e;
    }
  };
  const handleAvatarRemove = async () => {
    try {
      await authApi.deleteAvatar();
      setUser((prev) => (prev ? { ...prev, avatar_url: null } : prev));
    } catch (e) {
      message.error(apiErrorMessage(e, "头像移除失败，请重试"));
      throw e;
    }
  };
  const saveDisplayName = async () => {
    setNameSaving(true);
    try {
      const updated = await authApi.updateProfile(nameDraft.trim() || null);
      setUser(updated);
      nameDirtyRef.current = false;
      message.success(t("home.profile.displayNameSaved"));
    } catch (e) {
      message.error(apiErrorMessage(e, "保存失败，请重试"));
    } finally {
      setNameSaving(false);
    }
  };
  const pwIssueText = (issue: ReturnType<typeof passwordPolicyIssue>) => {
    switch (issue) {
      case "same_as_old":
        return "新密码不能与当前密码相同";
      case "too_short":
        return `新密码至少 ${MIN_PASSWORD_LENGTH} 位`;
      case "need_letter_and_digit":
        return "新密码需同时包含字母和数字";
      case "too_common":
        return "新密码太常见，请换一个";
      default:
        return "新密码强度不足";
    }
  };
  const openPwModal = () => {
    setPwOld("");
    setPwNext("");
    setPwConfirm("");
    setPwError("");
    setPwOpen(true);
  };
  const submitPassword = async () => {
    if (!pwOld) {
      setPwError("请输入当前密码");
      return;
    }
    const issue = passwordPolicyIssue(pwNext, pwOld);
    if (issue) {
      setPwError(pwIssueText(issue));
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwError("两次输入的新密码不一致");
      return;
    }
    setPwBusy(true);
    setPwError("");
    try {
      await authApi.changePassword(pwOld, pwNext);
      message.success(t("home.profile.passwordChanged"));
      setPwOpen(false);
    } catch (e) {
      setPwError(apiErrorMessage(e, "密码修改失败，请重试"));
    } finally {
      setPwBusy(false);
    }
  };

  const chatHref = agentId
    ? "/chat/" +
      encodeURIComponent(agentId) +
      (activeThread ? "/" + encodeURIComponent(activeThread) : "")
    : "/chat";
  const hasChat = activeThread !== null;
  const platformVisible = isHomeRoute && platformOpen;
  // 平台 iframe（内置平台/创作预览）里的页面不渲染工作台菜单：
  // 外壳已提供返回与应用栏，保留菜单会诱导用户在 iframe 里再开内置平台（无限嵌套）。
  const framedView = isRunningInFrame();
  const currentSection = featureTitle(location.pathname);
  const activeAssignment = activeThread
    ? assignmentByThread.get(activeThread)
    : undefined;
  const composerProjectId = activeThread
    ? activeAssignment?.project_id ?? null
    : pendingAssignment?.projectId ?? activeProject;
  const composerFolderId = activeThread
    ? activeAssignment?.folder_id ?? null
    : pendingAssignment?.folderId ?? activeFolder;
  const composerProject = projects.find(
    (project) => project.project_id === composerProjectId,
  );
  const composerFolder = folders.find(
    (folder) => folder.folder_id === composerFolderId,
  );

  return (
    <div
      className={
        "wb-root" +
        (platformVisible || framedView ? " wb-root-platform" : "") +
        (mobileNavOpen ? " is-mobile-nav-open" : "") +
        (sideCollapsed ? " wb-side-collapsed" : "")
      }
      style={themeArtworkStyle}
    >
      {!platformVisible && mobileNavOpen && (
        <button
          type="button"
          className="wb-mobile-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      {!platformVisible && !framedView && (
        <aside className={"wb-side" + (mobileNavOpen ? " is-open" : "")}>
          <button
            className="wb-brand"
            type="button"
            onClick={handleBrandClick}
            aria-label={brandLabel}
            title={brandLabel}
          >
            <span className="wb-brand-mark">
              <img src="/lyra-dino.svg" alt="" width="36" height="36" />
            </span>
            <span className="wb-brand-copy">
              <strong>LYRA</strong>
              <small>私有云工作台</small>
            </span>
          </button>
          <button className="wb-newtask" type="button" onClick={newTask}>
            <Plus size={18} /> 新建任务
          </button>
          <nav className="wb-nav" aria-label="主导航">
            {NAV_ITEMS.map(({ path, label, Icon }) => (
              <button
                type="button"
                key={path}
                className={
                  "wb-nav-item" +
                  (location.pathname === path ||
                  location.pathname.startsWith(path + "/")
                    ? " is-active"
                    : "")
                }
                aria-current={
                  location.pathname === path ||
                  location.pathname.startsWith(path + "/")
                    ? "page"
                    : undefined
                }
                onClick={() => navigateFromWorkbench(path)}
              >
                {label === "Agent" ? (
                  <img src="/lyra-dino.svg" width="19" height="19" alt="" />
                ) : (
                  <Icon size={17} />
                )}
                <span>{label}</span>
                {label === "Agent" && (
                  <span className="wb-cue" aria-hidden="true">
                    Cue!
                  </span>
                )}
              </button>
            ))}
            <Popover
              trigger="click"
              overlayClassName="wb-theme-popup"
              open={moreOpen}
              onOpenChange={setMoreOpen}
              placement="rightTop"
              arrow={false}
              content={
                <div className="wb-menu-popup">
                  {moreItems.map((item) => (
                    <button
                      type="button"
                      key={item.path}
                      onClick={() => navigateFromWorkbench(item.path)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              }
            >
              <button
                className="wb-nav-item"
                type="button"
                aria-expanded={moreOpen}
              >
                <span className="wb-more-dots">•••</span>
                <span>更多</span>
                <ChevronRight size={15} className="wb-nav-chevron" />
              </button>
            </Popover>
          </nav>
          {agentId && (
            <div className="wb-sidebar-section wb-projects-head">
              <button
                type="button"
                className="wb-projects-toggle"
                aria-expanded={!projectsCollapsed}
                title={t("workbench.home.projects.title")}
                onClick={toggleProjectsCollapsed}
              >
                <strong>{t("workbench.home.projects.title")}</strong>
                <ChevronDown
                  size={13}
                  className={projectsCollapsed ? "" : "is-open"}
                />
              </button>
              <span className="wb-projects-head-actions">
                <Dropdown
                  trigger={["click"]}
                  placement="bottomRight"
                  overlayClassName="wb-theme-popup"
                  menu={{
                    items: [
                      {
                        key: "new",
                        label: t("workbench.home.projects.newProject"),
                      },
                      {
                        key: "github",
                        label: t("workbench.home.projects.githubImport"),
                      },
                      ...(projects.some(
                        (item) => item.project_id === activeProject,
                      )
                        ? [
                            { type: "divider" as const },
                            {
                              key: "share",
                              label: t("workbench.home.projects.shareProject"),
                            },
                            {
                              key: "rename",
                              label: t("workbench.home.projects.editProject"),
                            },
                            {
                              key: "icon",
                              label: t(
                                "workbench.home.projects.editProjectIcon",
                              ),
                            },
                            { type: "divider" as const },
                            {
                              key: "delete",
                              label: t("workbench.home.projects.deleteProject"),
                              danger: true,
                            },
                          ]
                        : []),
                    ],
                    onClick: ({ key }: { key: string }) => {
                      const project = projects.find(
                        (item) => item.project_id === activeProject,
                      );
                      if (key === "new") {
                        openCreateProject();
                        return;
                      }
                      if (key === "github") {
                        setGithubRefDraft("");
                        setProjectModal({ mode: "github" });
                        return;
                      }
                      if (project) runProjectMenu(key, project);
                    },
                  }}
                >
                  <button
                    type="button"
                    aria-label={t("workbench.home.projects.projectActions")}
                  >
                    <Ellipsis size={14} />
                  </button>
                </Dropdown>
                <button
                  type="button"
                  aria-label={t("workbench.home.projects.newProject")}
                  onClick={openCreateProject}
                >
                  <Plus size={14} />
                </button>
              </span>
            </div>
          )}
          {agentId && !projectsCollapsed && (
            <>
              {(projectChildren.get(null) ?? []).map((project) =>
                renderProjectNode(project, 0),
              )}
              <section className="wb-sidebar-section wb-recycle-section">
                <button
                  type="button"
                  className="wb-task-filter"
                  aria-expanded={recycleBinOpen}
                  onClick={() => setRecycleBinOpen((open) => !open)}
                >
                  <strong>{t("workbench.home.projects.recycleBin")}</strong>
                  <span>{recycledFolders.length}</span>
                </button>
                {recycleBinOpen && (
                  <div className="wb-recycled-folders">
                    {recycledFolders.length === 0 ? (
                      <span className="wb-recycle-empty">
                        {t("workbench.home.projects.recycleBinEmpty")}
                      </span>
                    ) : (
                      recycledFolders.map((folder) => (
                        <div
                          className="wb-recycled-folder"
                          key={folder.folder_id}
                        >
                          <Folder size={13} />
                          <span title={folder.name}>{folder.name}</span>
                          <button
                            type="button"
                            aria-label={t(
                              "workbench.home.projects.restoreFolderNamed",
                              { name: folder.name },
                            )}
                            title={t("workbench.home.projects.restoreFolder")}
                            onClick={() =>
                              void restoreFolder(folder.folder_id).catch(() =>
                                setError(
                                  t(
                                    "workbench.home.projects.restoreFolderFailed",
                                  ),
                                ),
                              )
                            }
                          >
                            <RotateCcw size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          <div className="wb-sidebar-section wb-task-section">
            <button
              type="button"
              className="wb-task-filter"
              onClick={() => {
                setActiveProject(null);
                setActiveFolder(null);
                if (!activeThread) setPendingAssignment(null);
              }}
            >
              <strong>{t("workbench.home.projects.tasks")}</strong>
              <span>{visibleThreads.length}</span>
            </button>
            <button
              type="button"
              className="wb-task-collapse"
              aria-expanded={!tasksCollapsed}
              aria-label={t(
                tasksCollapsed
                  ? "workbench.home.projects.expandTasks"
                  : "workbench.home.projects.collapseTasks",
              )}
              onClick={toggleTasksCollapsed}
            >
              <ChevronDown
                size={13}
                className={tasksCollapsed ? "" : "is-open"}
              />
            </button>
          </div>
          {!tasksCollapsed && (
            <div className="wb-task-list" aria-label="会话历史">
              {visibleThreads.length === 0 && (
                <p className="wb-task-empty">
                  {activeFolder
                    ? t("workbench.home.projects.emptyFolder")
                    : activeProject
                    ? t("workbench.home.projects.emptyProject")
                    : t("workbench.home.projects.emptyAll")}
                </p>
              )}
              {visibleThreads.map((thread) => renderTaskRow(thread))}
              {archivedThreads.length > 0 && (
                <button
                  type="button"
                  className="wb-archived-toggle"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  <ChevronDown
                    size={13}
                    className={showArchived ? "is-open" : ""}
                  />
                  已归档 <span>{archivedThreads.length}</span>
                </button>
              )}
              {showArchived &&
                archivedThreads.map((thread) => renderTaskRow(thread))}
            </div>
          )}
          <div className="wb-sidebar-footer-row">
            <Dropdown
              trigger={["click"]}
              placement="topRight"
              overlayClassName="wb-account-dropdown"
              arrow={false}
              open={accountMenuOpen}
              onOpenChange={setAccountMenuOpen}
              popupRender={() => (
                <div className="wb-account-menu">
                  <div className="wb-account-head">
                    <ProfileAvatar
                      url={user?.avatar_url}
                      icon={user?.avatar_icon}
                      kind="user"
                      className="wb-account-avatar"
                    />
                    <div className="wb-account-meta">
                      <div className="wb-account-name">
                        <span className="wb-account-display">
                          {displayName}
                        </span>
                        {user?.role === "admin" && (
                          <span className="wb-account-role">管理员</span>
                        )}
                      </div>
                      {user?.username && (
                        <span className="wb-account-handle">
                          @{user.username}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="wb-account-group">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setMobileNavOpen(false);
                        setSettingsOpen(true);
                      }}
                    >
                      <Settings2 size={16} />
                      <span>设置</span>
                      <ChevronRight size={14} className="wb-account-chevron" />
                    </button>
                  </div>
                  <div className="wb-account-group wb-account-group-danger">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        void handleLogout();
                      }}
                    >
                      <LogOut size={16} />
                      <span>{t("auth.logout")}</span>
                    </button>
                  </div>
                </div>
              )}
            >
              <button
                type="button"
                className="wb-sidebar-footer"
                aria-label="账户菜单"
                aria-haspopup="menu"
              >
                <ProfileAvatar
                  url={user?.avatar_url}
                  icon={user?.avatar_icon}
                  kind="user"
                  className="wb-user-avatar"
                />
                <span>{displayName}</span>
                <span className="wb-footer-space" />
                <ChevronRight size={16} />
              </button>
            </Dropdown>
          </div>
        </aside>
      )}

      {platformVisible ? (
        <main className="wb-platform-shell">
          <div className="wb-platform-bar">
            <button
              type="button"
              className="wb-platform-back"
              onClick={() => setPlatformOpen(false)}
            >
              <ArrowLeft size={18} /> 返回工作台
            </button>
            <div className="wb-platform-title">
              <span className="wb-platform-icon">
                <Layers3 size={18} />
              </span>
              <strong>
                {selectedPlatform?.name || t("workbench.home.platforms.title")}
              </strong>
              <small>
                {selectedPlatform?.description ||
                  t("workbench.home.platforms.subtitle")}
              </small>
            </div>
            <div className="wb-platform-actions">
              {platformSrc && (
                <a
                  className="wb-platform-external"
                  href={platformSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} /> 新窗口打开
                </a>
              )}
              {selectedPlatformId === "app:planet" && (
                <button
                  type="button"
                  onClick={() => setPlatformSettingsOpen((v) => !v)}
                  aria-label="平台地址设置"
                >
                  <Settings2 size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const el = document.querySelector(".wb-platform-shell");
                  if (el instanceof HTMLElement && el.requestFullscreen)
                    void el.requestFullscreen();
                }}
                aria-label="全屏显示平台"
              >
                <Maximize2 size={17} />
              </button>
              <button
                type="button"
                onClick={() => setPlatformOpen(false)}
                aria-label="关闭平台"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          {platformSettingsOpen && (
            <form
              className="wb-platform-settings"
              onSubmit={(e) => {
                e.preventDefault();
                savePlatformUrl();
              }}
            >
              <label htmlFor="wb-platform-url">
                平台访问地址（同一私有云主机，支持独立端口）
              </label>
              <div>
                <input
                  id="wb-platform-url"
                  value={platformDraft}
                  onChange={(e) => setPlatformDraft(e.target.value)}
                  type="url"
                  autoComplete="url"
                />
                <button type="submit">保存并打开</button>
              </div>
              <p>
                这里接入现有的星球乐园工作台，不重建它的页面。平台的
                Agent、模型及登录由平台自身管理；LYRA 不会将登录令牌传入平台。
              </p>
            </form>
          )}
          {error && (
            <div className="wb-alert" role="alert">
              {error}
            </div>
          )}
          <div className="wb-platform-content">
            <nav
              className="wb-platform-apps"
              aria-label={t("workbench.home.platforms.title")}
            >
              <strong>{t("workbench.home.platforms.apps")}</strong>
              {platformCatalogError && (
                <p className="wb-platform-catalog-error" role="alert">
                  {t("workbench.home.platforms.loadFailed")}
                </p>
              )}
              {platformEntries.map((entry) => {
                const deployed = Boolean(entry.url);
                return (
                  <div className="wb-platform-app-row" key={entry.id}>
                    <button
                      type="button"
                      disabled={Boolean(
                        entry.launchable && launchingProjectId === entry.itemId,
                      )}
                      className={
                        "wb-platform-app" +
                        (selectedPlatformId === entry.id ? " is-active" : "") +
                        (!deployed ? " is-unavailable" : "")
                      }
                      onClick={() => void openPlatformEntry(entry)}
                    >
                      {entry.thumb ? (
                        entry.thumb.startsWith("/api/creations/") ? (
                          <AuthImage
                            url={entry.thumb}
                            alt=""
                            className="wb-platform-app-image"
                          />
                        ) : (
                          <img src={entry.thumb} alt="" />
                        )
                      ) : (
                        <span className="wb-platform-app-icon">
                          <Layers3 size={18} />
                        </span>
                      )}
                      <span className="wb-platform-app-copy">
                        <b>{entry.name}</b>
                        <small>
                          {entry.description ||
                            t("workbench.home.platforms.noDescription")}
                        </small>
                      </span>
                      {!deployed && (
                        <small className="wb-platform-app-status">
                          {t("workbench.home.platforms.notDeployed")}
                        </small>
                      )}
                      {entry.launchable &&
                        launchingProjectId === entry.itemId && (
                          <small
                            className="wb-platform-app-status"
                            role="status"
                          >
                            {t("workbench.home.platforms.starting")}
                          </small>
                        )}
                      {deployed &&
                        !resolvePrivatePlatformUrl(
                          entry.id === "app:planet"
                            ? platformUrl
                            : entry.url || "",
                          window.location.hostname,
                          window.location.protocol,
                        ) && <ExternalLink size={14} />}
                    </button>
                    {entry.launchable &&
                      user?.role === "admin" &&
                      projectLaunchStatuses[entry.itemId!]?.status ===
                        "running" && (
                        <button
                          type="button"
                          className="wb-platform-stop"
                          disabled={launchingProjectId === entry.itemId}
                          onClick={async () => {
                            setLaunchingProjectId(entry.itemId!);
                            try {
                              const status = await creationsApi.stopProject(
                                entry.itemId!,
                              );
                              setProjectLaunchStatuses((previous) => ({
                                ...previous,
                                [entry.itemId!]: status,
                              }));
                              setProjectPreviewUrls((previous) => {
                                const next = { ...previous };
                                delete next[entry.itemId!];
                                return next;
                              });
                            } catch {
                              setError(
                                t("workbench.home.platforms.previewFailed"),
                              );
                            } finally {
                              setLaunchingProjectId(null);
                            }
                          }}
                        >
                          {t("workbench.home.platforms.stop")}
                        </button>
                      )}
                  </div>
                );
              })}
            </nav>
            {selectedPlatform && !selectedPlatform.url ? (
              <div className="wb-platform-placeholder">
                <CircleHelp size={32} />
                <h2>{t("workbench.home.platforms.notDeployed")}</h2>
                <p>
                  {selectedPlatform.name} ·{" "}
                  {selectedPlatform.description ||
                    t("workbench.home.platforms.noDescription")}
                </p>
              </div>
            ) : platformSrc ? (
              <div className="wb-platform-viewport">
                {!platformFrameReady && (
                  <div className="wb-platform-loading" role="status">
                    {t("workbench.home.platforms.opening", {
                      name: selectedPlatform?.name || "",
                    })}
                  </div>
                )}
                <iframe
                  key={platformSrc}
                  title={
                    selectedPlatform?.name ||
                    t("workbench.home.platforms.title")
                  }
                  className="wb-platform-frame"
                  src={platformSrc}
                  onLoad={() => setPlatformFrameReady(true)}
                  referrerPolicy="no-referrer"
                  allow="fullscreen; clipboard-read; clipboard-write"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="wb-platform-placeholder">
                <CircleHelp size={32} />
                <h2>{t("workbench.home.platforms.externalTitle")}</h2>
                <p>{t("workbench.home.platforms.externalDescription")}</p>
              </div>
            )}
          </div>
        </main>
      ) : !isHomeRoute ? (
        <main
          className="wb-main wb-feature-main"
          aria-label={currentSection + "页面"}
        >
          <header className="wb-topbar">
            <button
              type="button"
              className="wb-mobile-toggle"
              aria-label="打开导航"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="wb-breadcrumb">
              <button className="wb-home-link" type="button" onClick={newTask}>
                LYRA SPACE
              </button>
              <ChevronRight size={13} />
              <strong>{currentSection}</strong>
            </div>
            <div className="wb-topbar-right">
              <span className="wb-status">
                <span
                  className={primary ? "wb-status-dot" : "wb-status-dot is-off"}
                />
                {agentsLoading
                  ? "正在连接…"
                  : primary
                  ? "主 Agent 已连接"
                  : "未发现运行中的 Agent"}
              </span>
              <span className="wb-topbar-divider" />
              <span className="wb-private-label">
                <ShieldCheck size={14} /> 私有云
              </span>
            </div>
          </header>
          <section
            className="wb-feature-content"
            aria-label={currentSection + "内容"}
          >
            <MainLayout embedded />
          </section>
        </main>
      ) : (
        <main className="wb-main">
          <header className="wb-topbar">
            <button
              type="button"
              className="wb-mobile-toggle"
              aria-label="打开导航"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="wb-breadcrumb">
              <span>LYRA SPACE</span>
              <ChevronRight size={13} />
              <strong>工作台</strong>
              {/* 平台 iframe 里再开「内置平台」会无限嵌套，入口只在顶层保留。 */}
              {!framedView && (
                <div
                  className="wb-mode-tabs"
                  role="group"
                  aria-label="工作区模式"
                >
                  <button
                    type="button"
                    className="is-selected"
                    aria-current="page"
                    onClick={() => setPlatformOpen(false)}
                  >
                    <MessageCircle size={14} /> 主 Agent 对话
                  </button>
                  <button type="button" onClick={openPlatform}>
                    <Layers3 size={14} /> 内置平台
                  </button>
                </div>
              )}
            </div>
            <div className="wb-topbar-right">
              <span className="wb-status">
                <span
                  className={primary ? "wb-status-dot" : "wb-status-dot is-off"}
                />
                {agentsLoading
                  ? "正在连接…"
                  : primary
                  ? "主 Agent 已连接"
                  : "未发现运行中的 Agent"}
              </span>
              <span className="wb-topbar-divider" />
              <span className="wb-private-label">
                <ShieldCheck size={14} /> 私有云
              </span>
            </div>
          </header>

          <div className="wb-workspace-body">
            <div className="wb-center-column">
              {hasChat && (
                <section className="wb-conversation" aria-label="主 Agent 对话">
                  <div className="wb-conversation-head">
                    <div className="wb-agent-bubble">
                      <ExpertAgentAvatar
                        iconName={primary?.icon_name}
                        iconUrl={primary?.icon_url}
                        color={primary?.color}
                        size={40}
                      />
                    </div>
                    <div>
                      <h1>{primary?.name || "主 Agent"}</h1>
                      <p>
                        {teamReady
                          ? "正在由主 Agent 统一规划与协调团队"
                          : "单 Agent 模式 · 配置团队后即可自动分发任务"}
                      </p>
                    </div>
                    <span className="wb-conversation-spacer" />
                    <button
                      type="button"
                      className="wb-secondary-button"
                      onClick={() => navigate(chatHref)}
                    >
                      <ExternalLink size={15} /> 高级对话
                    </button>
                  </div>
                  <div
                    className="wb-chat-scroll"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {historyLoading && visibleMessages.length === 0 && (
                      <div className="wb-chat-loading">正在载入会话…</div>
                    )}
                    {historyError && (
                      <div className="wb-alert" role="alert">
                        会话加载失败。可以从高级对话中重试。
                      </div>
                    )}
                    {visibleMessageGroups.map((group, index) => {
                      if (group.isGroup) {
                        return (
                          <AssistantTurnView
                            key={group.messages[0]?.id ?? index}
                            messages={group.messages}
                            agentId={agentId}
                            isTurnInProgress={
                              isStreaming &&
                              index === visibleMessageGroups.length - 1
                            }
                            liveSpeakers={liveSpeakers}
                          />
                        );
                      }
                      const userMessage = group.messages[0];
                      if (!userMessage || userMessage.role !== "user")
                        return null;
                      return (
                        <article
                          key={userMessage.id}
                          className="wb-chat-message is-user"
                        >
                          <div className="wb-chat-avatar">
                            {displayName.slice(0, 1)}
                          </div>
                          <div className="wb-chat-message-body">
                            <div className="wb-chat-author">
                              你<time>{formatTime(userMessage.timestamp)}</time>
                            </div>
                            <div className="wb-chat-text">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {userMessage.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {isStreaming &&
                      !visibleMessageGroups[visibleMessageGroups.length - 1]
                        ?.isGroup && (
                        <div className="wb-thinking">
                          <Sparkles size={15} /> 主 Agent 正在处理任务…
                        </div>
                      )}
                    {hasPendingApproval && (
                      <div className="wb-approval">
                        <Wrench size={17} />
                        <span>
                          任务需要人工授权，请进入高级对话处理，避免误操作。
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate(chatHref)}
                        >
                          处理授权 <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                </section>
              )}

              <div
                className={
                  "wb-composer-wrap" +
                  (hasChat ? " wb-composer-inchat" : " wb-composer-empty")
                }
              >
                {error && (
                  <div className="wb-alert" role="alert">
                    {error}
                  </div>
                )}
                <div className="wb-composer">
                  {uploadItems.length > 0 && (
                    <div className="wb-composer-attachments">
                      {uploadItems.map((item) => {
                        const isDone =
                          item.status === "done" && item.attachment;
                        const failed = item.status === "failed";
                        return (
                          <span
                            key={item.key}
                            className={
                              "wb-attachment-chip" +
                              (isDone ? "" : " is-uploading") +
                              (failed ? " is-failed" : "")
                            }
                            data-upload-status={item.status}
                          >
                            {isDone
                              ? isDone.filename || "文件"
                              : (failed ? "上传失败 · " : "上传中 · ") +
                                item.file.name}
                            {failed && (
                              <button
                                type="button"
                                onClick={() => retryUpload(item.key)}
                                aria-label="重试上传"
                                title="重试上传"
                              >
                                <RotateCcw size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeUpload(item.key)}
                              aria-label="移除附件"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={!primary || agentsLoading || sending}
                    aria-label="给主 Agent 发消息"
                    placeholder={
                      primary
                        ? "给主 Agent 一个任务，或者聊聊你的想法…"
                        : "请先在 Agent 团队中启动主 Agent"
                    }
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="wb-composer-bottom">
                    {composerProject && (
                      <span
                        className="wb-composer-project"
                        title={t("workbench.home.projects.currentProject", {
                          name: composerProject.name,
                        })}
                      >
                        <Folder size={14} />
                        <span>
                          {t("workbench.home.projects.currentProject", {
                            name: composerProject.name,
                          })}
                        </span>
                        {composerFolder && (
                          <>
                            <ChevronRight size={12} />
                            <span>{composerFolder.name}</span>
                          </>
                        )}
                      </span>
                    )}
                    <Dropdown
                      trigger={["click"]}
                      placement="topLeft"
                      overlayClassName="wb-theme-popup"
                      onOpenChange={(open) => {
                        if (!open || !agentId) return;
                        void acpApi
                          .getConfig(agentId)
                          .then((config) => setAcpRunners(config.runners || {}))
                          .catch(() => {});
                      }}
                      menu={{
                        items: agentMenuItems,
                        onClick: handleAgentMenu,
                        selectedKeys:
                          usingAcpRunner && activeAcpRunner
                            ? [`acp:${activeAcpRunner}`]
                            : primary?.agent_id
                            ? [primary.agent_id]
                            : [],
                      }}
                    >
                      <button
                        type="button"
                        className="wb-composer-agent"
                        aria-label="选择对话 Agent"
                        title="选择由哪个 Agent 处理消息"
                      >
                        {usingAcpRunner ? (
                          <Bot size={15} />
                        ) : primary ? (
                          <ExpertAgentAvatar
                            iconName={primary.icon_name}
                            iconUrl={primary.icon_url}
                            color={primary.color}
                            size={18}
                          />
                        ) : (
                          <Bot size={15} />
                        )}
                        {usingAcpRunner
                          ? activeAcpRunnerLabel
                          : primary?.name || "选择 Agent"}{" "}
                        <ChevronDown size={13} />
                      </button>
                    </Dropdown>
                    <Dropdown
                      trigger={["click"]}
                      placement="topRight"
                      align={{
                        offset: [window.innerWidth <= 740 ? -150 : 0, 0],
                      }}
                      overlayClassName="wb-theme-popup"
                      open={!usingAcpRunner && modelPickerOpen}
                      onOpenChange={(open) => {
                        setModelPickerOpen(open);
                        if (!open) setModelProviderMenuOpen(false);
                      }}
                      dropdownRender={(menu) => (
                        <div className="wb-model-picker">
                          {!usingAcpRunner && selectedProviderGroup && (
                            <>
                              <button
                                type="button"
                                className="wb-model-picker-heading"
                                aria-label={t(
                                  "chat.selectModelProvider",
                                  "切换模型提供商",
                                )}
                                aria-expanded={modelProviderMenuOpen}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const open = !modelProviderMenuOpen;
                                  setModelProviderMenuOpen(open);
                                }}
                              >
                                <span className="wb-model-provider-logo">
                                  <Cpu size={15} />
                                </span>
                                <span className="wb-model-provider-name">
                                  {selectedProviderGroup.name}
                                </span>
                                <ChevronRight size={15} />
                              </button>
                              {modelProviderMenuOpen && (
                                <div
                                  className="wb-model-provider-menu"
                                  role="menu"
                                  aria-label={t(
                                    "chat.selectModelProvider",
                                    "切换模型提供商",
                                  )}
                                >
                                  {modelProviderGroups.map((group) => (
                                    <button
                                      key={group.id}
                                      type="button"
                                      role="menuitem"
                                      className="wb-model-provider-option"
                                      aria-current={
                                        group.id === selectedProviderGroup.id
                                          ? "true"
                                          : undefined
                                      }
                                      onClick={() => {
                                        setModelPickerProviderId(group.id);
                                        setModelProviderMenuOpen(false);
                                      }}
                                    >
                                      <span>{group.name}</span>
                                      {group.id ===
                                        selectedProviderGroup.id && (
                                        <Check size={14} />
                                      )}
                                    </button>
                                  ))}
                                  <div className="wb-model-provider-divider" />
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="wb-model-provider-manage"
                                    onClick={() => {
                                      setModelPickerOpen(false);
                                      setModelProviderMenuOpen(false);
                                      navigate("/admin/models");
                                    }}
                                  >
                                    {t("chat.modelPickerManage")}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          {menu}
                          {showReasoningControls && (
                            <div className="wb-reasoning-panel">
                              <div className="wb-reasoning-effort">
                                <label htmlFor="wb-reasoning-effort">
                                  {t("chat.reasoningEffort", "思考强度")}
                                </label>
                                <span>{reasoningSliderLabel}</span>
                                <kbd aria-hidden="true">Ctrl+T</kbd>
                                <input
                                  id="wb-reasoning-effort"
                                  type="range"
                                  min={0}
                                  max={Math.max(reasoningEfforts.length - 1, 1)}
                                  step={1}
                                  value={reasoningSliderValue}
                                  style={
                                    {
                                      "--reasoning-progress": `${
                                        (reasoningSliderValue /
                                          Math.max(
                                            reasoningEfforts.length - 1,
                                            1,
                                          )) *
                                        100
                                      }%`,
                                    } as CSSProperties
                                  }
                                  aria-label={t(
                                    "chat.reasoningEffort",
                                    "思考强度",
                                  )}
                                  aria-valuetext={reasoningSliderLabel}
                                  onChange={(event) => {
                                    const index = Number(event.target.value);
                                    const effort = reasoningEfforts[index];
                                    if (effort) {
                                      handleReasoningEffortChange(effort);
                                    } else {
                                      handleReasoningToggle(index === 1);
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      menu={{
                        items: modelMenuItems,
                        onClick: handleModelMenu,
                        selectedKeys: [selectedModel || "auto"],
                      }}
                    >
                      <button
                        type="button"
                        className="wb-composer-model-trigger"
                        style={{ display: usingAcpRunner ? "none" : undefined }}
                        aria-label={t("chat.selectModel", "选择模型")}
                        title={t("chat.selectModel", "选择模型")}
                        disabled={!modelsReady}
                      >
                        <Cpu size={14} />
                        <span>
                          {selectedModelLabel
                            ? selectedModelLabel
                            : t("chat.modelAuto", "自动")}
                        </span>
                        <ChevronDown size={13} />
                      </button>
                    </Dropdown>
                    <Dropdown
                      trigger={["click"]}
                      placement="topLeft"
                      overlayClassName="wb-theme-popup"
                      menu={{ items: plusMenuItems, onClick: handlePlusMenu }}
                    >
                      <button
                        type="button"
                        className="wb-composer-plus"
                        aria-label="添加内容"
                      >
                        <Plus size={17} />
                      </button>
                    </Dropdown>
                    <span className="wb-composer-spacer" />
                    <span className="wb-composer-tip">
                      Enter 发送 · Shift+Enter 换行
                    </span>
                    {sttAvailable && (
                      <button
                        type="button"
                        aria-label="语音输入"
                        title={
                          voiceInput.recording ? "停止语音输入" : "语音输入"
                        }
                        className={
                          "wb-composer-mic" +
                          (voiceInput.recording ? " is-recording" : "")
                        }
                        onClick={() => voiceInput.toggle()}
                      >
                        <Mic size={17} />
                      </button>
                    )}
                    {isStreaming ? (
                      <button
                        type="button"
                        className="wb-composer-send is-stop"
                        onClick={cancelStream}
                        aria-label="停止生成"
                      >
                        <Square size={17} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="wb-composer-send"
                        disabled={
                          (!input.trim() && attachments.length === 0) ||
                          uploading ||
                          !primary ||
                          sending ||
                          hasPendingApproval
                        }
                        onClick={() => void send()}
                        aria-label="发送消息"
                      >
                        <Send size={17} />
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      )}
      <Modal
        title={null}
        className="wb-settings-modal"
        open={settingsOpen}
        footer={null}
        onCancel={closeSettings}
        width={settingsSection ? 1080 : 880}
        styles={{ body: { padding: 0 } }}
      >
        <div className="wb-set-shell">
          <aside className="wb-set-nav">
            <button
              type="button"
              className={
                "wb-set-nav-item" + (settingsSection ? "" : " is-active")
              }
              onClick={() => setSettingsSection(null)}
            >
              <Settings2 size={15} /> 通用
            </button>
            {SETTINGS_NAV.map((group) => (
              <div className="wb-set-nav-group" key={group.title}>
                <div className="wb-set-nav-title">{group.title}</div>
                {group.items.map(({ path, label, desc, Icon }) => (
                  <button
                    key={path}
                    type="button"
                    className={
                      "wb-set-nav-item" +
                      (settingsSection === path ? " is-active" : "")
                    }
                    title={desc}
                    onClick={() => setSettingsSection(path)}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <section
            className={
              "wb-set-panel" + (settingsSection ? " wb-set-panel-embed" : "")
            }
          >
            {settingsSection ? (
              <Suspense
                fallback={
                  <div className="wb-set-embed-loading">
                    <Spin />
                  </div>
                }
              >
                <SettingsSectionPanel
                  path={settingsSection}
                  onExit={exitSettingsSection}
                />
              </Suspense>
            ) : (
              <>
                <h3>通用</h3>
                <div className="wb-set-label">个人账户</div>
                <div className="wb-set-account">
                  <ProfileAvatarPicker
                    kind="user"
                    avatarUrl={user?.avatar_url}
                    icon={user?.avatar_icon}
                    onSelectIcon={handleAvatarIcon}
                    onPick={handleAvatarUpload}
                    onRemove={handleAvatarRemove}
                  />
                  <div className="wb-set-field">
                    <div className="wb-set-field-info">
                      <strong>显示名称</strong>
                      <small>在工作台与对话中展示的名字</small>
                    </div>
                    <div className="wb-set-account-name">
                      <Input
                        value={nameDraft}
                        maxLength={64}
                        style={{ width: 170 }}
                        placeholder={user?.username || "显示名称"}
                        onChange={(e) => {
                          setNameDraft(e.target.value);
                          nameDirtyRef.current = true;
                        }}
                        onPressEnter={() => {
                          if (!nameSaving) void saveDisplayName();
                        }}
                      />
                      <Button
                        type="primary"
                        size="small"
                        loading={nameSaving}
                        disabled={
                          (nameDraft.trim() || null) ===
                          (user?.display_name ?? null)
                        }
                        onClick={() => {
                          void saveDisplayName();
                        }}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                  <div className="wb-set-field">
                    <div className="wb-set-field-info">
                      <strong>登录密码</strong>
                      <small>
                        账号 {user?.username || "—"} · 修改后下次登录使用新密码
                      </small>
                    </div>
                    <Button size="small" onClick={openPwModal}>
                      修改密码
                    </Button>
                  </div>
                </div>
                <div className="wb-set-label">外观</div>
                <div className="wb-set-field wb-set-card">
                  <div className="wb-set-field-info">
                    <strong>语言</strong>
                    <small>工作台界面显示语言</small>
                  </div>
                  <Select
                    value={currentLocale}
                    classNames={{ popup: { root: "wb-theme-popup" } }}
                    style={{ width: 170 }}
                    onChange={(v) => void handleLocaleChange(v)}
                    options={[
                      { value: "zh", label: "简体中文" },
                      { value: "en", label: "English" },
                    ]}
                  />
                </div>
                <div className="wb-set-field wb-set-card">
                  <div className="wb-set-field-info">
                    <strong>主题</strong>
                    <small>浅色、深色或跟随系统</small>
                  </div>
                  <div className="wb-set-themes">
                    {THEME_OPTIONS.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className={
                          "wb-set-theme" +
                          (preference === key ? " is-active" : "")
                        }
                        onClick={() => setPreference(key)}
                      >
                        <Icon size={18} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wb-set-label">
                  {t("workbench.home.themeGallery.title")}
                </div>
                <div
                  className="wb-set-gallery"
                  role="group"
                  aria-label={t("workbench.home.themeGallery.title")}
                >
                  {THEME_GALLERY_OPTIONS.map((option) => {
                    const selected = skin === option.id;
                    return (
                      <button
                        className={
                          "wb-set-gallery-card" + (selected ? " is-active" : "")
                        }
                        key={option.id}
                        type="button"
                        aria-label={t(
                          `workbench.home.themeGallery.themes.${option.galleryKey}`,
                        )}
                        aria-pressed={selected}
                        style={{
                          backgroundImage: `linear-gradient(180deg, rgba(8, 15, 28, 0.02) 25%, rgba(8, 15, 28, 0.62) 100%), url("${option.image}")`,
                        }}
                        onClick={() => setSkin(option.id)}
                      >
                        <span>
                          {t(
                            `workbench.home.themeGallery.themes.${option.galleryKey}`,
                          )}
                        </span>
                        {selected ? (
                          <Check size={14} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                  <div
                    className="wb-set-gallery-card is-coming-soon"
                    role="listitem"
                  >
                    {t("workbench.home.themeGallery.comingSoon")}
                  </div>
                </div>
                <div className="wb-set-label">更多设置</div>
                <p className="wb-set-note">
                  系统类设置在左侧选择后，在此窗口内直接管理；模型、ACP
                  协作、插件等工具入口在侧栏「更多」菜单。
                </p>
              </>
            )}
          </section>
        </div>
      </Modal>
      <Modal
        title="修改密码"
        open={pwOpen}
        width={400}
        footer={null}
        onCancel={() => setPwOpen(false)}
      >
        <form
          className="wb-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pwBusy) void submitPassword();
          }}
        >
          <Input.Password
            autoFocus
            value={pwOld}
            autoComplete="current-password"
            placeholder="当前密码"
            onChange={(e) => setPwOld(e.target.value)}
          />
          <Input.Password
            value={pwNext}
            autoComplete="new-password"
            placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位，含字母和数字）`}
            onChange={(e) => setPwNext(e.target.value)}
          />
          <Input.Password
            value={pwConfirm}
            autoComplete="new-password"
            placeholder="确认新密码"
            onChange={(e) => setPwConfirm(e.target.value)}
          />
          {pwError && <p className="wb-pw-error">{pwError}</p>}
          <div className="wb-project-form-actions">
            <button
              type="button"
              className="wb-form-btn"
              onClick={() => setPwOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="wb-form-btn is-primary"
              disabled={pwBusy}
            >
              修改密码
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        title={t(
          projectModal?.mode === "editIcon"
            ? "workbench.home.projects.editProjectIcon"
            : projectModal?.mode === "github"
            ? "workbench.home.projects.githubImportTitle"
            : "workbench.home.projects.newProjectTitle",
        )}
        open={!!projectModal}
        width={420}
        footer={null}
        onCancel={() => {
          if (!githubBusy) setProjectModal(null);
        }}
      >
        <form
          className="wb-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitProjectModal();
          }}
        >
          {projectModal?.mode === "create" && (
            <Input
              autoFocus
              value={projectNameDraft}
              maxLength={80}
              onChange={(e) => setProjectNameDraft(e.target.value)}
              placeholder={t("workbench.home.projects.newProjectPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitProjectModal();
                }
              }}
            />
          )}
          {projectModal?.mode === "github" && (
            <Input
              autoFocus
              value={githubRefDraft}
              maxLength={300}
              onChange={(e) => setGithubRefDraft(e.target.value)}
              placeholder={t("workbench.home.projects.githubImportPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitProjectModal();
                }
              }}
            />
          )}
          {projectModal?.mode !== "github" && (
            <EmojiPicker
              value={projectIconDraft}
              onChange={setProjectIconDraft}
              fallback="📁"
            />
          )}
          <div className="wb-project-form-actions">
            <button
              type="button"
              className="wb-form-btn"
              onClick={() => setProjectModal(null)}
            >
              {t("workbench.home.projects.cancel")}
            </button>
            <button
              type="submit"
              className="wb-form-btn is-primary"
              disabled={projectModal?.mode === "github" && githubBusy}
            >
              {projectModal?.mode === "github"
                ? t("workbench.home.projects.githubImportSubmit")
                : t(
                    projectModal?.mode === "editIcon"
                      ? "common.save"
                      : "common.create",
                  )}
            </button>
          </div>
          {projectModal?.mode === "github" && (
            <p className="wb-project-form-note">
              {t("workbench.home.projects.githubImportHint")}
            </p>
          )}
          {projectModal?.mode === "create" && projectModal.assignThreadId && (
            <p className="wb-project-form-note">
              创建后，会话「
              {threads.find((t) => t.thread_id === projectModal.assignThreadId)
                ?.title || "新的对话"}
              」将归入该项目。
            </p>
          )}
        </form>
      </Modal>
      <Modal
        title={t("workbench.home.projects.manageKnowledge")}
        open={!!knowledgeProject}
        width={520}
        confirmLoading={projectKnowledgeSaving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        okButtonProps={{
          disabled: projectKnowledgeLoading || projectKnowledgeLoadFailed,
        }}
        onCancel={() => setKnowledgeProject(null)}
        onOk={() => {
          if (!knowledgeProject) return;
          setProjectKnowledgeSaving(true);
          void workbenchApi
            .setProjectKnowledgeBases(
              knowledgeProject.project_id,
              projectKnowledgeIds,
            )
            .then((ids) => {
              setProjects((items) =>
                items.map((item) =>
                  item.project_id === knowledgeProject.project_id
                    ? { ...item, knowledge_base_ids: ids }
                    : item,
                ),
              );
              setKnowledgeProject(null);
            })
            .catch(() =>
              setError(t("workbench.home.projects.knowledgeSaveFailed")),
            )
            .finally(() => setProjectKnowledgeSaving(false));
        }}
      >
        <p>{t("workbench.home.projects.knowledgeHint")}</p>
        {projectKnowledgeLoadFailed && (
          <p>{t("workbench.home.projects.knowledgeLoadFailed")}</p>
        )}
        <Select
          mode="multiple"
          value={projectKnowledgeIds}
          loading={projectKnowledgeLoading}
          onChange={setProjectKnowledgeIds}
          options={knowledgeBases.map((base) => ({
            label: base.name,
            value: base.id,
          }))}
          placeholder={t("workbench.home.projects.knowledgePlaceholder")}
          style={{ width: "100%" }}
          optionFilterProp="label"
        />
      </Modal>
      <Modal
        title={t("workbench.home.projects.newFolder")}
        open={!!folderModal}
        width={420}
        footer={null}
        onCancel={() => setFolderModal(null)}
      >
        <form
          className="wb-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitFolderModal();
          }}
        >
          <Input
            autoFocus
            value={folderNameDraft}
            maxLength={64}
            onChange={(e) => setFolderNameDraft(e.target.value)}
            placeholder={t("workbench.home.projects.newFolderPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitFolderModal();
              }
            }}
          />
          <div className="wb-project-form-actions">
            <button
              type="button"
              className="wb-form-btn"
              onClick={() => setFolderModal(null)}
            >
              {t("workbench.home.projects.cancel")}
            </button>
            <button type="submit" className="wb-form-btn is-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
      {codeBrowserProjectId && (
        <ProjectCodeBrowser
          projectId={codeBrowserProjectId}
          open={Boolean(codeBrowserProjectId)}
          onClose={() => setCodeBrowserProjectId(null)}
        />
      )}
      {shareDialogProject && (
        <ProjectShareDialog
          project={shareDialogProject}
          onClose={() => setShareDialogProject(null)}
        />
      )}
      {contextDialogProject && (
        <ProjectContextDialog
          project={contextDialogProject}
          onClose={() => setContextDialogProject(null)}
        />
      )}
      {runsDialogProject && (
        <ProjectRunsDialog
          project={runsDialogProject}
          onClose={() => setRunsDialogProject(null)}
        />
      )}
    </div>
  );
}
