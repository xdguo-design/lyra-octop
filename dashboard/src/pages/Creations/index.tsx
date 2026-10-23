import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Folder,
  FolderPlus,
  Github,
  Pencil,
  Plus,
  Smartphone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import AuthImage from "../../components/AuthImage";
import { request } from "../../api/request";
import {
  creationsApi,
  type CreationCardMeta,
  type CreationFolder,
  type CreationItem,
  type CreationItemInput,
  type ProjectLaunchStatus,
} from "../../api/modules/creations";
import {
  BUILT_IN_CREATIONS,
  type BuiltInAppCreation,
} from "./builtInCreations";
import { message } from "../../utils/antdMessage";
import "./creations.css";

type CreationCategory = "platform" | "service" | "repository" | "applet";

interface BaseCreation {
  id: string;
  title: string;
  desc: string;
  category: CreationCategory;
  folderId: string | null;
}

interface AppCreation extends BaseCreation {
  type: "app";
  thumb?: string;
  url: string;
  route?: string;
}

interface ExternalCreation extends BaseCreation {
  type: "external";
  thumb?: string;
  url: string | null;
}

interface UserCreation extends BaseCreation {
  type: "platform" | "service" | "applet";
  itemId: string;
  url: string | null;
  thumbnailUrl: string | null;
}

type Creation = AppCreation | ExternalCreation | UserCreation;
type Dialog = "folder" | "entry" | "card" | null;

function isGithubRepositoryUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
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

function isLaunchableProjectUrl(value: string | null): boolean {
  return isGithubRepositoryUrl(value);
}

function creationCategory(item: CreationItem): CreationCategory {
  return item.kind === "service" && isGithubRepositoryUrl(item.url)
    ? "repository"
    : item.kind;
}

function creationUrlLabel(value: string): string | null {
  try {
    const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
    if (hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname)) {
      return null;
    }
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  } catch {
    return null;
  }
}

function hasUrlCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? "";
    return Boolean(url.username || url.password || authority.includes("@"));
  } catch {
    return false;
  }
}

function creationThumbnail(creation: Creation): string | null {
  if (creation.type === "app" || creation.type === "external") {
    return creation.thumb || null;
  }
  if (creation.type === "service" && creation.thumbnailUrl) {
    return creation.thumbnailUrl;
  }
  if (creation.type === "service" && isLaunchableProjectUrl(creation.url)) {
    return "/workbench/thumbs/data-upload-product.png";
  }
  if (creation.type === "service" && creation.url) {
    const hostname = new URL(creation.url).hostname.replace(/^www\./, "");
    if (hostname === "freellm.top")
      return "/workbench/thumbs/manus-freellm.png";
  }
  return null;
}

const STAR_STORAGE_KEY = "octop:creations:starred";
function loadStarred(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STAR_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function CreationsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState<CreationCategory | "all">("all");
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [starred, setStarred] = useState<Set<string>>(loadStarred);
  const [isAdmin, setIsAdmin] = useState(false);
  const [launchStatuses, setLaunchStatuses] = useState<
    Record<string, ProjectLaunchStatus>
  >({});
  const [folders, setFolders] = useState<CreationFolder[]>([]);
  const [items, setItems] = useState<CreationItem[]>([]);
  const [cardFolders, setCardFolders] = useState<Record<string, string>>({});
  const [cardMeta, setCardMeta] = useState<Record<string, CreationCardMeta>>(
    {},
  );
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [projectPreview, setProjectPreview] = useState<{
    title: string;
    url: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [entryKind, setEntryKind] = useState<CreationItem["kind"]>("platform");
  const [isGithubProjectForm, setIsGithubProjectForm] = useState(false);
  const [editingItem, setEditingItem] = useState<CreationItem | null>(null);
  const [editingFolder, setEditingFolder] = useState<CreationFolder | null>(
    null,
  );
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<CreationCategory>("applet");
  const [formUrl, setFormUrl] = useState("");
  const [formFolder, setFormFolder] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [githubRefDraft, setGithubRefDraft] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);

  const refreshCreations = useCallback(async () => {
    const data = await creationsApi.list();
    setFolders(data.folders);
    setItems(data.items);
    setCardFolders(data.card_folders);
    setCardMeta(data.card_meta ?? {});
  }, []);

  useEffect(() => {
    let alive = true;
    void request<{ role?: string }>("/auth/me")
      .then((value) => {
        if (alive) setIsAdmin(value.role === "admin");
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    void refreshCreations().catch(() => {
      if (alive) message.error(t("creationsPage.messages.loadFailed"));
    });
    return () => {
      alive = false;
    };
  }, [refreshCreations, t]);

  useEffect(() => {
    if (openId !== "admission-registration") return;
    const closePreview = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== "octop:close-creation-preview"
      ) {
        return;
      }
      setOpenId(null);
      setProjectPreview(null);
    };
    window.addEventListener("message", closePreview);
    return () => window.removeEventListener("message", closePreview);
  }, [openId]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const targets = items.filter(
      (item) => item.kind === "service" && isLaunchableProjectUrl(item.url),
    );
    void Promise.all(
      targets.map(async (item) => {
        try {
          return [
            item.item_id,
            await creationsApi.launchStatus(item.item_id),
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!alive) return;
      setLaunchStatuses((previous) => ({
        ...previous,
        ...Object.fromEntries(results.filter((result) => result !== null)),
      }));
    });
    return () => {
      alive = false;
    };
  }, [isAdmin, items]);

  const creations = useMemo<Creation[]>(() => {
    const apps = BUILT_IN_CREATIONS.filter((app) => app.type === "app").map(
      (app) => {
        const meta = cardMeta[`app:${app.id}`];
        return {
          ...app,
          title: meta?.name?.trim() || t(app.titleKey),
          desc: meta?.description?.trim() || t(app.descriptionKey),
          category: meta?.category ?? app.category,
          folderId: cardFolders[`app:${app.id}`] ?? null,
        };
      },
    );
    const manusApps = BUILT_IN_CREATIONS.filter(
      (item) => item.type === "external",
    ).map((item) => {
      const meta = cardMeta[`app:${item.id}`];
      return {
        ...item,
        title: meta?.name?.trim() || t(item.titleKey),
        desc: meta?.description?.trim() || t(item.descriptionKey),
        category: meta?.category ?? item.category,
        folderId: cardFolders[`app:${item.id}`] ?? null,
      };
    });
    const userItems = items.map((item) => ({
      type: item.kind,
      id: item.item_id,
      itemId: item.item_id,
      title: item.name,
      desc:
        item.description ||
        t(
          item.kind === "platform"
            ? "creationsPage.builtIn.platformDescription"
            : "creationsPage.builtIn.serviceDescription",
        ),
      category: creationCategory(item),
      folderId: item.folder_id,
      url: item.url,
      thumbnailUrl: item.thumbnail_url,
    }));
    return [...userItems, ...apps, ...manusApps];
  }, [cardFolders, cardMeta, items, t]);

  const categories: Array<CreationCategory | "all"> = [
    "all",
    "platform",
    "applet",
    "service",
    "repository",
  ];
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return creations.filter((creation) => {
      if (tab !== "all" && creation.category !== tab) return false;
      if (selectedFolder === "unfiled" && creation.folderId) return false;
      if (
        selectedFolder !== "all" &&
        selectedFolder !== "unfiled" &&
        creation.folderId !== selectedFolder
      )
        return false;
      if (!kw) return true;
      return (
        creation.title.toLowerCase().includes(kw) ||
        creation.desc.toLowerCase().includes(kw)
      );
    });
  }, [creations, keyword, selectedFolder, tab]);

  const resetForm = () => {
    setDialog(null);
    setEditingItem(null);
    setEditingFolder(null);
    setEditingCardId(null);
    setIsGithubProjectForm(false);
    setFormName("");
    setFormDescription("");
    setFormUrl("");
    setFormFolder("");
    setGithubRefDraft("");
  };

  const autofillFromGithub = async () => {
    const ref = githubRefDraft.trim();
    if (!ref) {
      message.error(t("creationsPage.messages.githubRefInvalid"));
      return;
    }
    const match = ref
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!match) {
      message.error(t("creationsPage.messages.githubRefInvalid"));
      return;
    }
    setGithubBusy(true);
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${match[1]}/${match[2]}`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (resp.status === 404) {
        message.error(t("creationsPage.messages.githubRefNotFound"));
        return;
      }
      if (resp.status === 403 || resp.status === 429) {
        message.error(t("creationsPage.messages.githubRefRateLimited"));
        return;
      }
      if (!resp.ok) {
        message.error(t("creationsPage.messages.githubRefFailed"));
        return;
      }
      const repo = await resp.json();
      const fullName = String(repo.full_name ?? `${match[1]}/${match[2]}`);
      const name = String(
        (repo.name && String(repo.name).slice(0, 120)) || fullName,
      );
      const url = repo.html_url || `https://github.com/${match[1]}/${match[2]}`;
      const bits: string[] = [];
      if (repo.description) bits.push(String(repo.description));
      const meta: string[] = [];
      if (repo.language) meta.push(String(repo.language));
      if (typeof repo.stargazers_count === "number")
        meta.push(`★ ${repo.stargazers_count}`);
      if (meta.length > 0) bits.push(meta.join(" · "));
      setFormName(name);
      setFormUrl(url);
      setFormDescription(bits.join(" — ").slice(0, 2000));
    } catch {
      message.error(t("creationsPage.messages.githubRefFailed"));
    } finally {
      setGithubBusy(false);
    }
  };

  const openNewEntry = (kind: CreationItem["kind"], githubProject = false) => {
    setEntryKind(kind);
    setIsGithubProjectForm(githubProject);
    setEditingItem(null);
    setEditingFolder(null);
    setFormName("");
    setFormDescription("");
    setFormUrl("");
    setFormFolder(
      selectedFolder === "all" || selectedFolder === "unfiled"
        ? ""
        : selectedFolder,
    );
    setDialog("entry");
  };

  const editEntry = (entry: CreationItem) => {
    setEntryKind(entry.kind);
    setIsGithubProjectForm(false);
    setEditingItem(entry);
    setEditingFolder(null);
    setEditingCardId(null);
    setFormName(entry.name);
    setFormDescription(entry.description);
    setFormUrl(entry.url ?? "");
    setFormFolder(entry.folder_id ?? "");
    setDialog("entry");
  };

  const editBuiltInCard = (creation: AppCreation | ExternalCreation) => {
    const source = BUILT_IN_CREATIONS.find((item) => item.id === creation.id);
    if (!source) return;
    setEntryKind("service");
    setIsGithubProjectForm(false);
    setEditingItem(null);
    setEditingFolder(null);
    setEditingCardId(`app:${creation.id}`);
    const meta = cardMeta[`app:${creation.id}`];
    setFormName(meta?.name || t(source.titleKey));
    setFormDescription(meta?.description || t(source.descriptionKey));
    setFormCategory(meta?.category ?? source.category);
    setFormUrl("");
    setFormFolder("");
    setDialog("card");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      dialog === "entry" &&
      isGithubProjectForm &&
      !isGithubRepositoryUrl(formUrl)
    ) {
      message.error(t("creationsPage.messages.invalidGithubUrl"));
      return;
    }
    if (
      dialog === "entry" &&
      entryKind !== "platform" &&
      formUrl.trim() &&
      hasUrlCredentials(formUrl.trim())
    ) {
      message.error(t("creationsPage.messages.urlCredentialsNotAllowed"));
      return;
    }
    setFormSaving(true);
    try {
      if (dialog === "folder") {
        if (editingFolder) {
          await creationsApi.renameFolder(editingFolder.folder_id, formName);
        } else {
          await creationsApi.createFolder(formName);
        }
      } else if (dialog === "card" && editingCardId) {
        const cardId = editingCardId.slice("app:".length);
        const source = BUILT_IN_CREATIONS.find((item) => item.id === cardId);
        const saved = await creationsApi.setCardMeta("app", cardId, {
          name: formName.trim() || null,
          description: formDescription.trim() || null,
          category: source ? formCategory : null,
        });
        setCardMeta((previous) => ({ ...previous, [editingCardId]: saved }));
      } else if (dialog === "entry") {
        const body: CreationItemInput = {
          kind: entryKind,
          name: formName,
          description: formDescription,
          url: entryKind === "platform" ? null : formUrl.trim() || null,
          folder_id: formFolder || null,
        };
        if (editingItem)
          await creationsApi.updateItem(editingItem.item_id, body);
        else await creationsApi.createItem(body);
      }
      await refreshCreations();
      resetForm();
    } catch {
      message.error(t("creationsPage.messages.saveFailed"));
    } finally {
      setFormSaving(false);
    }
  };

  const toggleStar = (id: string) => {
    setStarred((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(
          STAR_STORAGE_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        /* storage optional */
      }
      return next;
    });
  };

  const copyLink = async (
    creation: AppCreation | ExternalCreation | UserCreation,
  ) => {
    if (!creation.url) return;
    try {
      await navigator.clipboard.writeText(creation.url);
    } catch {
      /* clipboard may be blocked; still show feedback */
    }
    setCopiedId(creation.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const openCreation = (creation: Creation) => {
    if (creation.type === "service" && isLaunchableProjectUrl(creation.url)) {
      if (isAdmin) void openProjectPreview(creation);
      else if (creation.url)
        window.open(creation.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (creation.type === "app" && creation.route) navigate(creation.route);
    else if (creation.type === "app") {
      setProjectPreview(null);
      setOpenId(creation.id);
    } else if (creation.type === "external") {
      if (creation.url)
        window.open(creation.url, "_blank", "noopener,noreferrer");
    } else if (
      (creation.type === "service" || creation.type === "applet") &&
      creation.url
    ) {
      window.open(creation.url, "_blank", "noopener,noreferrer");
    } else {
      navigate("/chat", {
        state: {
          prefillInput: t("creationsPage.builtIn.buildPrompt", {
            name: creation.title,
          }),
        },
      });
    }
  };

  const launchProject = async (itemId: string, stop = false) => {
    if (!stop) {
      setLaunchStatuses((previous) => ({
        ...previous,
        [itemId]: {
          status: "starting",
          url: null,
          logs: null,
          thumbnail_url: null,
        },
      }));
    }
    try {
      const status = stop
        ? await creationsApi.stopProject(itemId)
        : await creationsApi.startProject(itemId);
      setLaunchStatuses((previous) => ({ ...previous, [itemId]: status }));
      if (status.thumbnail_url) {
        setItems((previous) =>
          previous.map((item) =>
            item.item_id === itemId
              ? { ...item, thumbnail_url: status.thumbnail_url }
              : item,
          ),
        );
      }
      if (status.status === "failed")
        message.error(
          `${t("creationsPage.actions.previewFailed")}${
            status.logs ? `: ${status.logs}` : ""
          }`,
        );
      return status;
    } catch {
      message.error(t("creationsPage.actions.previewFailed"));
      return null;
    }
  };

  const openProjectPreview = async (creation: UserCreation) => {
    const current = launchStatuses[creation.itemId];
    if (current?.status === "starting") return;
    const status =
      current?.status === "running" && current.url
        ? current
        : await launchProject(creation.itemId);
    if (status?.status === "running" && status.url) {
      setOpenId(null);
      setProjectPreview({ title: creation.title, url: status.url });
    }
  };

  const setFolder = async (creation: Creation, folderId: string) => {
    try {
      const nextFolder = folderId || null;
      if (
        creation.type === "platform" ||
        creation.type === "service" ||
        creation.type === "applet"
      ) {
        const item = items.find((value) => value.item_id === creation.itemId);
        if (!item) return;
        await creationsApi.updateItem(item.item_id, {
          kind: item.kind,
          name: item.name,
          description: item.description,
          url: item.url,
          folder_id: nextFolder,
        });
        setItems((previous) =>
          previous.map((value) =>
            value.item_id === item.item_id
              ? { ...value, folder_id: nextFolder }
              : value,
          ),
        );
      } else {
        await creationsApi.setCardFolder("app", creation.id, nextFolder);
        const key = `app:${creation.id}`;
        setCardFolders((previous) => {
          const next = { ...previous };
          if (nextFolder) next[key] = nextFolder;
          else delete next[key];
          return next;
        });
      }
    } catch {
      message.error(t("creationsPage.messages.moveFailed"));
    }
  };

  const deleteEntry = async (entry: UserCreation) => {
    if (
      !window.confirm(
        t("creationsPage.messages.deleteItemConfirm", { name: entry.title }),
      )
    )
      return;
    try {
      await creationsApi.deleteItem(entry.itemId);
      setItems((previous) =>
        previous.filter((item) => item.item_id !== entry.itemId),
      );
    } catch {
      message.error(t("creationsPage.messages.deleteFailed"));
    }
  };

  const deleteFolder = async () => {
    const folder = folders.find((item) => item.folder_id === selectedFolder);
    if (
      !folder ||
      !window.confirm(
        t("creationsPage.messages.deleteFolderConfirm", {
          name: folder.name,
        }),
      )
    )
      return;
    try {
      await creationsApi.deleteFolder(folder.folder_id);
      setSelectedFolder("all");
      await refreshCreations();
    } catch {
      message.error(t("creationsPage.messages.deleteFolderFailed"));
    }
  };

  const renameFolder = () => {
    const folder = folders.find((item) => item.folder_id === selectedFolder);
    if (!folder) return;
    setEditingItem(null);
    setEditingFolder(folder);
    setFormName(folder.name);
    setDialog("folder");
  };

  const openedSource =
    BUILT_IN_CREATIONS.find(
      (creation): creation is BuiltInAppCreation =>
        creation.type === "app" && creation.id === openId,
    ) ?? null;
  const opened = openedSource
    ? {
        ...openedSource,
        title: t(openedSource.titleKey),
        desc: t(openedSource.descriptionKey),
      }
    : null;
  const activePreview = opened ?? projectPreview;

  return (
    <div className="cr-page">
      <header className="cr-header">
        <div className="cr-heading">
          <h1 className="cr-title">{t("creationsPage.title")}</h1>
          <p className="cr-subtitle">{t("creationsPage.subtitle")}</p>
        </div>
        <div className="cr-search">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("creationsPage.search")}
            aria-label={t("creationsPage.search")}
          />
        </div>
        <div className="cr-header-actions">
          <button
            type="button"
            className="cr-act"
            onClick={() => openNewEntry("platform")}
          >
            <Plus size={14} />
            {t("creationsPage.actions.createPlatform")}
          </button>
          <button
            type="button"
            className="cr-act"
            onClick={() => openNewEntry("service")}
          >
            <ExternalLink size={14} />
            {t("creationsPage.actions.registerService")}
          </button>
          <button
            type="button"
            className="cr-act"
            onClick={() => openNewEntry("applet")}
          >
            <Smartphone size={14} />
            {t("creationsPage.actions.registerApplet")}
          </button>
          <button
            type="button"
            className="cr-act"
            onClick={() => openNewEntry("service", true)}
          >
            <Github size={14} />
            {t("creationsPage.actions.addGithubProject")}
          </button>
          <button
            type="button"
            className="cr-act"
            onClick={() => {
              setEditingItem(null);
              setEditingFolder(null);
              setFormName("");
              setDialog("folder");
            }}
          >
            <FolderPlus size={14} />
            {t("creationsPage.folders.create")}
          </button>
        </div>
      </header>

      <div
        className="cr-tabs"
        role="tablist"
        aria-label={t("creationsPage.title")}
      >
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={tab === category}
            className={`cr-tab${tab === category ? " is-active" : ""}`}
            onClick={() => setTab(category)}
          >
            {t(`creationsPage.categories.${category}`)}
          </button>
        ))}
      </div>

      <div
        className="cr-folders"
        role="group"
        aria-label={t("creationsPage.folders.label")}
      >
        <button
          type="button"
          aria-pressed={selectedFolder === "all"}
          className={`cr-folder-tab${
            selectedFolder === "all" ? " is-active" : ""
          }`}
          onClick={() => setSelectedFolder("all")}
        >
          {t("creationsPage.folders.all")}
        </button>
        <button
          type="button"
          aria-pressed={selectedFolder === "unfiled"}
          className={`cr-folder-tab${
            selectedFolder === "unfiled" ? " is-active" : ""
          }`}
          onClick={() => setSelectedFolder("unfiled")}
        >
          {t("creationsPage.folders.unfiled")}
        </button>
        {folders.map((folder) => (
          <button
            key={folder.folder_id}
            type="button"
            aria-pressed={selectedFolder === folder.folder_id}
            className={`cr-folder-tab${
              selectedFolder === folder.folder_id ? " is-active" : ""
            }`}
            onClick={() => setSelectedFolder(folder.folder_id)}
          >
            <Folder size={13} />
            {folder.name}
          </button>
        ))}
        {folders.some((folder) => folder.folder_id === selectedFolder) && (
          <div className="cr-folder-actions">
            <button
              type="button"
              aria-label={t("creationsPage.folders.rename")}
              onClick={renameFolder}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={t("creationsPage.folders.delete")}
              onClick={() => void deleteFolder()}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="cr-grid">
        {visible.map((creation) => {
          const thumbnail = creationThumbnail(creation);
          const urlLabel = creation.url ? creationUrlLabel(creation.url) : null;
          return (
            <div key={creation.id} className="cr-card">
              <button
                type="button"
                className="cr-thumb"
                onClick={() => openCreation(creation)}
                aria-label={
                  creation.type === "platform"
                    ? t("creationsPage.actions.build")
                    : t("creationsPage.actions.open", { name: creation.title })
                }
              >
                {creation.type === "service" && creation.thumbnailUrl ? (
                  <AuthImage
                    url={creation.thumbnailUrl}
                    className="cr-auth-thumb"
                  />
                ) : thumbnail ? (
                  <img
                    src={thumbnail}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className={
                      thumbnail === "/workbench/thumbs/data-upload-product.png"
                        ? "cr-thumb-fit"
                        : undefined
                    }
                  />
                ) : (
                  <span className={`cr-thumb-symbol cr-thumb-${creation.type}`}>
                    {creation.type === "platform" ? (
                      t("creationsPage.categories.platform")
                    ) : creation.category === "repository" ? (
                      <Github size={30} />
                    ) : creation.type === "applet" ||
                      creation.category === "applet" ? (
                      <Smartphone size={30} />
                    ) : (
                      <ExternalLink size={30} />
                    )}
                  </span>
                )}
              </button>
              <div className="cr-body">
                {creation.type === "service" &&
                isLaunchableProjectUrl(creation.url) ? (
                  <button
                    type="button"
                    className="cr-name cr-name-action"
                    aria-label={t("creationsPage.actions.open", {
                      name: creation.title,
                    })}
                    onClick={() => openCreation(creation)}
                  >
                    {creation.title}
                  </button>
                ) : (
                  <strong className="cr-name">{creation.title}</strong>
                )}
                <small className="cr-meta" title={creation.desc}>
                  {creation.desc}
                </small>
                {(creation.type === "app" ||
                  creation.type === "service" ||
                  creation.type === "external") &&
                  urlLabel &&
                  (creation.type === "service" &&
                  isLaunchableProjectUrl(creation.url) ? (
                    <a
                      className="cr-link"
                      href={creation.url ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={urlLabel}
                    >
                      {urlLabel}
                    </a>
                  ) : (
                    <span className="cr-link" title={urlLabel}>
                      {urlLabel}
                    </span>
                  ))}
              </div>
              <div className="cr-actions">
                {isAdmin &&
                  creation.type === "service" &&
                  isLaunchableProjectUrl(creation.url) && (
                    <>
                      {launchStatuses[creation.itemId]?.status === "running" ? (
                        <>
                          <button
                            type="button"
                            className="cr-act"
                            onClick={() => {
                              const url = launchStatuses[creation.itemId]?.url;
                              if (url) void openProjectPreview(creation);
                            }}
                          >
                            {t("creationsPage.actions.openPreview")}
                          </button>
                          <button
                            type="button"
                            className="cr-act"
                            onClick={() =>
                              void launchProject(creation.itemId, true)
                            }
                          >
                            {t("creationsPage.actions.stopPreview")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="cr-act"
                          disabled={
                            launchStatuses[creation.itemId]?.status ===
                            "starting"
                          }
                          onClick={() => void launchProject(creation.itemId)}
                        >
                          {launchStatuses[creation.itemId]?.status ===
                          "starting"
                            ? t("creationsPage.actions.startingPreview")
                            : t("creationsPage.actions.startPreview")}
                        </button>
                      )}
                    </>
                  )}
                {creation.type === "platform" && (
                  <button
                    type="button"
                    className="cr-act"
                    onClick={() => openCreation(creation)}
                  >
                    {t("creationsPage.actions.build")}
                  </button>
                )}
                {creation.type === "external" && creation.url && (
                  <button
                    type="button"
                    className="cr-act"
                    onClick={() => openCreation(creation)}
                  >
                    {t("creationsPage.actions.openWork")}
                  </button>
                )}
                {creation.type !== "external" && (
                  <button
                    type="button"
                    className="cr-act"
                    onClick={() =>
                      navigate("/chat", {
                        state: {
                          prefillInput: t("creationsPage.builtIn.editPrompt", {
                            name: creation.title,
                          }),
                        },
                      })
                    }
                  >
                    {t("creationsPage.actions.editTask")}
                  </button>
                )}
                {(creation.type === "app" ||
                  creation.type === "service" ||
                  creation.type === "applet" ||
                  (creation.type === "external" && creation.url)) && (
                  <button
                    type="button"
                    className="cr-act"
                    onClick={() => void copyLink(creation)}
                  >
                    {copiedId === creation.id
                      ? t("creationsPage.actions.copied")
                      : t("creationsPage.actions.copy")}
                  </button>
                )}
                {creation.type === "app" && (
                  <button
                    type="button"
                    className="cr-icon-action"
                    aria-label={t("creationsPage.actions.edit", {
                      name: creation.title,
                    })}
                    onClick={() => editBuiltInCard(creation)}
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {(creation.type === "platform" ||
                  creation.type === "service" ||
                  creation.type === "applet") && (
                  <>
                    <button
                      type="button"
                      className="cr-icon-action"
                      aria-label={t("creationsPage.actions.edit", {
                        name: creation.title,
                      })}
                      onClick={() => {
                        const item = items.find(
                          (value) => value.item_id === creation.itemId,
                        );
                        if (item) editEntry(item);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="cr-icon-action"
                      aria-label={t("creationsPage.actions.delete", {
                        name: creation.title,
                      })}
                      onClick={() => void deleteEntry(creation)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <select
                  aria-label={t("creationsPage.actions.move", {
                    name: creation.title,
                  })}
                  value={creation.folderId ?? ""}
                  onChange={(event) =>
                    void setFolder(creation, event.target.value)
                  }
                >
                  <option value="">{t("creationsPage.folders.unfiled")}</option>
                  {folders.map((folder) => (
                    <option key={folder.folder_id} value={folder.folder_id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`cr-star${
                    starred.has(creation.id) ? " is-starred" : ""
                  }`}
                  aria-label={
                    starred.has(creation.id)
                      ? t("creationsPage.actions.unstar")
                      : t("creationsPage.actions.star")
                  }
                  aria-pressed={starred.has(creation.id)}
                  onClick={() => toggleStar(creation.id)}
                >
                  <Star size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="cr-empty">{t("creationsPage.messages.empty")}</p>
        )}
      </div>

      {dialog && (
        <div
          className="cr-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) resetForm();
          }}
        >
          <form
            className="cr-dialog"
            role="dialog"
            aria-modal="true"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="cr-dialog-header">
              <strong>
                {dialog === "folder"
                  ? editingFolder
                    ? t("creationsPage.dialog.renameFolder")
                    : t("creationsPage.dialog.newFolder")
                  : dialog === "card"
                  ? t("creationsPage.dialog.editCard")
                  : editingItem
                  ? t("creationsPage.dialog.editItem")
                  : entryKind === "platform"
                  ? t("creationsPage.dialog.newPlatform")
                  : entryKind === "applet"
                  ? t("creationsPage.dialog.newApplet")
                  : isGithubProjectForm
                  ? t("creationsPage.dialog.newGithubProject")
                  : t("creationsPage.dialog.newService")}
              </strong>
              <button
                type="button"
                className="cr-icon-action"
                aria-label={t("common.close", "关闭")}
                onClick={resetForm}
              >
                <X size={16} />
              </button>
            </div>
            <label>
              {t("creationsPage.dialog.name")}
              <input
                required
                maxLength={dialog === "folder" ? 64 : 120}
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                autoFocus
              />
            </label>
            {(dialog === "entry" || dialog === "card") && (
              <>
                <label>
                  {t("creationsPage.dialog.description")}
                  <textarea
                    maxLength={2000}
                    value={formDescription}
                    onChange={(event) => setFormDescription(event.target.value)}
                    rows={3}
                  />
                </label>
                {dialog === "card" &&
                  BUILT_IN_CREATIONS.some(
                    (item) => `app:${item.id}` === editingCardId,
                  ) && (
                    <label>
                      {t("creationsPage.dialog.category")}
                      <select
                        value={formCategory}
                        onChange={(event) =>
                          setFormCategory(
                            event.target.value as CreationCategory,
                          )
                        }
                      >
                        <option value="platform">
                          {t("creationsPage.categories.platform")}
                        </option>
                        <option value="applet">
                          {t("creationsPage.categories.applet")}
                        </option>
                        <option value="service">
                          {t("creationsPage.categories.service")}
                        </option>
                        <option value="repository">
                          {t("creationsPage.categories.repository")}
                        </option>
                      </select>
                    </label>
                  )}
                {dialog === "entry" &&
                  (entryKind === "service" || entryKind === "applet") && (
                    <label>
                      {isGithubProjectForm
                        ? t("creationsPage.dialog.githubUrl")
                        : entryKind === "applet"
                        ? t("creationsPage.dialog.appletUrl")
                        : t("creationsPage.dialog.url")}
                      <input
                        type="url"
                        required={entryKind === "service"}
                        placeholder={
                          isGithubProjectForm
                            ? "https://github.com/owner/repository"
                            : entryKind === "applet"
                            ? "https://example.com/app（可留空）"
                            : "https://example.com"
                        }
                        value={formUrl}
                        onChange={(event) => setFormUrl(event.target.value)}
                      />
                    </label>
                  )}
                {dialog === "entry" &&
                  entryKind === "service" &&
                  isGithubProjectForm &&
                  !editingItem && (
                    <>
                      <div className="cr-github-ref">
                        <input
                          value={githubRefDraft}
                          placeholder={t("creationsPage.dialog.githubRef")}
                          aria-label={t("creationsPage.dialog.githubHint")}
                          onChange={(event) =>
                            setGithubRefDraft(event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="cr-act"
                          disabled={githubBusy}
                          onClick={() => void autofillFromGithub()}
                        >
                          {githubBusy
                            ? t("creationsPage.dialog.githubFilling")
                            : t("creationsPage.dialog.githubAutofill")}
                        </button>
                      </div>
                      <small className="cr-dialog-note">
                        {t("creationsPage.dialog.githubHint")}
                      </small>
                    </>
                  )}
                {dialog === "entry" && (
                  <label>
                    {t("creationsPage.dialog.folder")}
                    <select
                      value={formFolder}
                      onChange={(event) => setFormFolder(event.target.value)}
                    >
                      <option value="">
                        {t("creationsPage.folders.unfiled")}
                      </option>
                      {folders.map((folder) => (
                        <option key={folder.folder_id} value={folder.folder_id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <div className="cr-dialog-actions">
              <button type="button" className="cr-act" onClick={resetForm}>
                {t("creationsPage.dialog.cancel")}
              </button>
              <button
                type="submit"
                className="cr-act cr-act-primary"
                disabled={formSaving}
              >
                {formSaving
                  ? t("creationsPage.dialog.saving")
                  : t("creationsPage.dialog.save")}
              </button>
            </div>
          </form>
        </div>
      )}

      {activePreview && (
        <div className="cr-overlay">
          <div className="cr-overlay-bar">
            <button
              type="button"
              onClick={() => {
                setOpenId(null);
                setProjectPreview(null);
              }}
            >
              <ArrowLeft size={15} />
              {t("creationsPage.title")}
            </button>
            <span className="cr-overlay-title">{activePreview.title}</span>
            <button
              type="button"
              className="cr-overlay-close"
              aria-label={t("common.close", "关闭")}
              onClick={() => {
                setOpenId(null);
                setProjectPreview(null);
              }}
            >
              <X size={15} />
            </button>
          </div>
          <iframe
            src={activePreview.url}
            title={`${activePreview.title} · 作品`}
            className="cr-overlay-frame"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}
    </div>
  );
}
