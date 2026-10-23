import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Boxes,
  CheckCircle2,
  Download,
  ExternalLink,
  GraduationCap,
  Link2,
  Package,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
} from "lucide-react";

import PageShell from "../../layouts/PageShell";
import {
  expertMarketApi,
  type MarketExpert,
} from "../../api/modules/expertMarket";
import {
  connectorsApi,
  type ConnectorCatalogEntry,
  type ConnectorInstance,
} from "../../api/modules/connectors";
import { pluginsApi, type MarketPlugin } from "../../api/modules/plugins";
import { skillPackagesApi } from "../../api/modules/skillPackages";
import type { SkillPackage } from "../../api/types/skillPackage";
import { request } from "../../api/request";
import { apiErrorMessage } from "../../utils/apiError";
import { pickLocale } from "../../utils/localizedText";
import { message } from "@/utils/antdMessage";
import styles from "./index.module.less";

type View = "experts" | "skills" | "connectors" | "plugins";
interface FreeLLMSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "verified";
  github_url: string;
  content_path: string;
  last_checked_at: string;
}
interface FreeLLMPreview extends FreeLLMSkill {
  markdown: string;
  content_bytes: number;
}
interface FreeLLMCatalog {
  items: FreeLLMSkill[];
  source: string;
  count: number;
}

const TABS: Array<{
  value: View;
  icon: typeof BookOpen;
  zh: string;
  en: string;
}> = [
  { value: "experts", icon: GraduationCap, zh: "专家", en: "Experts" },
  { value: "skills", icon: BookOpen, zh: "技能", en: "Skills" },
  { value: "connectors", icon: Link2, zh: "连接器", en: "Connectors" },
  { value: "plugins", icon: Puzzle, zh: "插件", en: "Plugins" },
];

export default function ResourceMarketplacePage() {
  const { i18n, t } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const word = (cn: string, en: string) => (zh ? cn : en);
  const navigate = useNavigate();
  const [tab, setTab] = useState<View>("skills");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [experts, setExperts] = useState<MarketExpert[]>([]);
  const [skills, setSkills] = useState<FreeLLMSkill[]>([]);
  const [connectors, setConnectors] = useState<ConnectorCatalogEntry[]>([]);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [plugins, setPlugins] = useState<MarketPlugin[]>([]);
  const [packages, setPackages] = useState<SkillPackage[]>([]);
  const [preview, setPreview] = useState<FreeLLMPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [packageId, setPackageId] = useState("");
  const [probeBusy, setProbeBusy] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<string, { ok: boolean; detail: string }>
  >({});

  const load = async () => {
    setLoading(true);
    const tasks = await Promise.allSettled([
      expertMarketApi.list(""),
      request<FreeLLMCatalog>("/skill-packages/freellm/catalog"),
      connectorsApi.catalog(),
      connectorsApi.listInstances(),
      pluginsApi.listMarket(),
      skillPackagesApi.listWritable(),
    ]);
    const names = [
      "experts",
      "skills",
      "connectors",
      "instances",
      "plugins",
      "packages",
    ] as const;
    const nextErrors: Record<string, string> = {};
    tasks.forEach((result, index) => {
      if (result.status === "rejected") {
        nextErrors[names[index]] = apiErrorMessage(
          result.reason,
          word("加载失败", "Could not load"),
          t,
        );
      }
    });
    if (tasks[0].status === "fulfilled") setExperts(tasks[0].value.items);
    if (tasks[1].status === "fulfilled") setSkills(tasks[1].value.items);
    if (tasks[2].status === "fulfilled") setConnectors(tasks[2].value);
    if (tasks[3].status === "fulfilled") setInstances(tasks[3].value);
    if (tasks[4].status === "fulfilled") setPlugins(tasks[4].value);
    if (tasks[5].status === "fulfilled") setPackages(tasks[5].value);
    setErrors(nextErrors);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const values =
      tab === "experts"
        ? experts
        : tab === "skills"
        ? skills
        : tab === "connectors"
        ? connectors
        : plugins;
    const needle = search.trim().toLocaleLowerCase();
    return values.filter((item) => {
      const detail =
        tab === "experts"
          ? [
              pickLocale((item as MarketExpert).label, zh ? "zh" : "en"),
              pickLocale((item as MarketExpert).description, zh ? "zh" : "en"),
              (item as MarketExpert).scene,
            ]
          : tab === "skills"
          ? [
              (item as FreeLLMSkill).name,
              (item as FreeLLMSkill).description,
              (item as FreeLLMSkill).category,
            ]
          : tab === "connectors"
          ? [
              (item as ConnectorCatalogEntry).name,
              (item as ConnectorCatalogEntry).description,
              (item as ConnectorCatalogEntry).category,
            ]
          : [
              (item as MarketPlugin).name,
              (item as MarketPlugin).description,
              (item as MarketPlugin).group,
            ];
      const group =
        tab === "experts"
          ? (item as MarketExpert).scene
          : tab === "skills"
          ? (item as FreeLLMSkill).category
          : tab === "connectors"
          ? (item as ConnectorCatalogEntry).category
          : (item as MarketPlugin).group;
      return (
        (category === "all" || group === category) &&
        detail.some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(needle),
        )
      );
    });
  }, [category, connectors, experts, plugins, search, skills, tab, zh]);

  const groups = useMemo(() => {
    const values =
      tab === "experts"
        ? experts.map((item) => item.scene)
        : tab === "skills"
        ? skills.map((item) => item.category)
        : tab === "connectors"
        ? connectors.map((item) => item.category)
        : plugins.map((item) => item.group);
    return [
      ...new Set(values.filter((value): value is string => Boolean(value))),
    ].sort();
  }, [connectors, experts, plugins, skills, tab]);

  const openSkill = async (skill: FreeLLMSkill) => {
    setPreviewBusy(true);
    setPreview(null);
    setPackageId("");
    try {
      setPreview(
        await request<FreeLLMPreview>(
          `/skill-packages/freellm/${encodeURIComponent(skill.id)}/preview`,
        ),
      );
    } catch (error) {
      message.error(
        apiErrorMessage(error, word("技能预览失败", "Skill preview failed"), t),
      );
    } finally {
      setPreviewBusy(false);
    }
  };
  const probeInstance = async (instanceId: string) => {
    if (probeBusy) return;
    setProbeBusy(instanceId);
    try {
      const result = await connectorsApi.testInstance(instanceId);
      const detail = result.ok
        ? word(
            `连通性通过 · ${
              result.tool_count ?? result.tools?.length ?? 0
            } 个工具已发现（未执行写操作）`,
            `Connection probe passed · ${
              result.tool_count ?? result.tools?.length ?? 0
            } tools discovered (no write action tested)`,
          )
        : result.error || word("连通性测试失败", "Connection probe failed");
      setProbeResults((prev) => ({
        ...prev,
        [instanceId]: { ok: result.ok, detail },
      }));
    } catch (error) {
      setProbeResults((prev) => ({
        ...prev,
        [instanceId]: {
          ok: false,
          detail: apiErrorMessage(
            error,
            word("连通性测试失败", "Connection probe failed"),
            t,
          ),
        },
      }));
    } finally {
      setProbeBusy(null);
    }
  };
  const customInstances = instances.filter(
    (item) => !connectors.some((entry) => entry.kind === item.kind),
  );
  const importSkill = async () => {
    if (!preview || !packageId || importBusy) return;
    setImportBusy(true);
    try {
      await request(
        `/skill-packages/${encodeURIComponent(
          packageId,
        )}/skills/freellm/import`,
        {
          method: "POST",
          body: JSON.stringify({ skill_id: preview.id, overwrite: false }),
        },
      );
      message.success(
        word(
          "技能已导入，尚需审核后才能交给 Agent 使用",
          "Skill imported; review it before enabling it for an agent",
        ),
      );
      setPreview(null);
      navigate("/skill-packages/manage");
    } catch (error) {
      message.error(
        apiErrorMessage(error, word("导入失败", "Import failed"), t),
      );
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <PageShell
      title={word("资源市场", "Resource marketplace")}
      subtitle={word(
        "专家、技能、连接器与插件，一站式发现和管理",
        "Explore experts, skills, connectors and plugins in one place",
      )}
      fill
    >
      <div className={styles.marketPage}>
        <div className={styles.topBar}>
          <nav
            className={styles.tabs}
            aria-label={word("资源类型", "Resource type")}
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  className={tab === item.value ? styles.activeTab : styles.tab}
                  onClick={() => {
                    setTab(item.value);
                    setCategory("all");
                    setSearch("");
                  }}
                >
                  <Icon size={18} /> {zh ? item.zh : item.en}
                </button>
              );
            })}
          </nav>
          <div className={styles.toolbar}>
            <Input
              prefix={<Search size={15} />}
              placeholder={word("搜索资源", "Search resources")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
              className={styles.search}
            />
            <Button
              icon={<RefreshCw size={15} />}
              onClick={() => void load()}
              loading={loading}
              aria-label={word("刷新", "Refresh")}
            />
            <Button
              onClick={() =>
                navigate(
                  tab === "experts"
                    ? "/experts"
                    : tab === "skills"
                    ? "/skill-packages/manage"
                    : tab === "connectors"
                    ? "/connectors"
                    : "/admin/plugins",
                )
              }
              icon={<Package size={15} />}
            >
              {tab === "skills"
                ? word("管理已安装", "Manage installed")
                : word("管理", "Manage")}
            </Button>
          </div>
        </div>
        {tab === "skills" ? (
          <div className={styles.sourceBar}>
            <span>
              <CheckCircle2 size={16} />
              {word("FreeLLM 已核验技能目录", "FreeLLM verified Skill catalog")}
            </span>
            <Typography.Text type="secondary">
              {word(
                "目录核验不代表运行安全，安装前请审阅 SKILL.md",
                "Catalog verification is not runtime safety approval",
              )}
            </Typography.Text>
            <a
              href="https://freellm.top/skills/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {word("访问 FreeLLM", "Open FreeLLM")} <ExternalLink size={13} />
            </a>
          </div>
        ) : null}
        <section
          className={styles.featured}
          aria-label={word("精选资源", "Featured resources")}
        >
          <div className={styles.sectionHeading}>
            {word("精选资源", "Featured")}
          </div>
          <div className={styles.featuredGrid}>
            {(tab === "experts"
              ? experts.slice(0, 4).map((item) => ({
                  key: item.slug,
                  name: pickLocale(item.label, zh ? "zh" : "en") || item.slug,
                  detail: pickLocale(item.description, zh ? "zh" : "en"),
                  action: () => navigate("/experts"),
                }))
              : tab === "skills"
              ? skills.slice(0, 4).map((item) => ({
                  key: item.id,
                  name: item.name,
                  detail: item.description,
                  action: () => void openSkill(item),
                }))
              : tab === "connectors"
              ? connectors.slice(0, 4).map((item) => ({
                  key: item.kind,
                  name: item.name,
                  detail: item.description,
                  action: () => navigate("/connectors"),
                }))
              : plugins.slice(0, 4).map((item) => ({
                  key: item.id,
                  name: item.name || item.id,
                  detail: item.description || "",
                  action: () => navigate("/admin/plugins?tab=market"),
                }))
            ).map((item) => (
              <button
                type="button"
                key={item.key}
                className={styles.featuredCard}
                onClick={item.action}
              >
                <span className={styles.featuredGlyph}>
                  <Boxes size={22} />
                </span>
                <strong>{item.name}</strong>
                <span className={styles.clamp}>{item.detail}</span>
                <Plus size={16} className={styles.addIcon} />
              </button>
            ))}
          </div>
        </section>
        <div className={styles.sectionHeading}>
          {word("浏览全部", "Browse all")}{" "}
          <span className={styles.muted}>{filtered.length}</span>
        </div>
        <div className={styles.filters}>
          {["all", ...groups].map((group) => (
            <button
              key={group}
              type="button"
              className={
                category === group ? styles.filterActive : styles.filter
              }
              onClick={() => setCategory(group)}
            >
              {group === "all" ? word("全部", "All") : group}
            </button>
          ))}
        </div>
        {errors[tab] ? (
          <div role="alert" className={styles.error}>
            {errors[tab]}
          </div>
        ) : null}
        {loading && filtered.length === 0 ? (
          <div className={styles.wait}>
            <Spin />
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            description={word("暂无符合条件的资源", "No matching resources")}
          />
        ) : (
          <div className={styles.cards}>
            {tab === "skills"
              ? (filtered as FreeLLMSkill[]).map((item) => (
                  <article className={styles.card} key={item.id}>
                    <div className={styles.cardTop}>
                      <span className={styles.glyph}>
                        <BookOpen size={22} />
                      </span>
                      <div className={styles.name}>{item.name}</div>
                      <Button
                        type="text"
                        icon={<Plus size={16} />}
                        aria-label={word("预览并安装", "Preview and install")}
                        onClick={() => void openSkill(item)}
                      />
                    </div>
                    <p className={styles.desc}>{item.description}</p>
                    <div className={styles.cardFoot}>
                      <Tag color="blue">{item.category}</Tag>
                      <span>{word("目录已核验", "Catalog verified")}</span>
                    </div>
                  </article>
                ))
              : tab === "experts"
              ? (filtered as MarketExpert[]).map((item) => (
                  <article className={styles.card} key={item.slug}>
                    <div className={styles.cardTop}>
                      <Avatar src={item.icon_url} shape="square" size={40}>
                        <GraduationCap size={20} />
                      </Avatar>
                      <div className={styles.name}>
                        {pickLocale(item.label, zh ? "zh" : "en") || item.slug}
                      </div>
                      <Button
                        type="text"
                        icon={<Plus size={16} />}
                        onClick={() => navigate("/experts")}
                        aria-label={word("管理专家", "Manage expert")}
                      />
                    </div>
                    <p className={styles.desc}>
                      {pickLocale(item.description, zh ? "zh" : "en")}
                    </p>
                    <div className={styles.cardFoot}>
                      <span>{item.scene || word("专家", "Expert")}</span>
                      <span>
                        {item.skill_count ?? item.skill_slugs?.length ?? 0}{" "}
                        Skills
                      </span>
                    </div>
                  </article>
                ))
              : tab === "connectors"
              ? (filtered as ConnectorCatalogEntry[]).map((item) => {
                  const installed = instances.filter(
                    (entry) =>
                      entry.kind === item.kind &&
                      entry.status === "active" &&
                      entry.has_credentials,
                  ).length;
                  return (
                    <article className={styles.card} key={item.kind}>
                      <div className={styles.cardTop}>
                        <span className={styles.glyph}>
                          <Link2 size={22} />
                        </span>
                        <div className={styles.name}>{item.name}</div>
                        <Button
                          type="text"
                          icon={<Plus size={16} />}
                          onClick={() => navigate("/connectors")}
                          aria-label={word("配置连接器", "Configure connector")}
                        />
                      </div>
                      <p className={styles.desc}>{item.description}</p>
                      <div className={styles.cardFoot}>
                        <span>{item.category}</span>
                        <span>
                          {installed
                            ? word(
                                `已连接 ${installed}`,
                                `Connected ${installed}`,
                              )
                            : word("需连接授权", "Authorization required")}
                        </span>
                        {instances
                          .filter(
                            (entry) =>
                              entry.kind === item.kind &&
                              entry.status === "active" &&
                              entry.has_credentials,
                          )
                          .slice(0, 1)
                          .map((instance) => (
                            <Button
                              key={instance.instance_id}
                              size="small"
                              loading={probeBusy === instance.instance_id}
                              onClick={() =>
                                void probeInstance(instance.instance_id)
                              }
                            >
                              {word("验证", "Probe")}
                            </Button>
                          ))}
                      </div>
                      {instances
                        .filter((entry) => entry.kind === item.kind)
                        .slice(0, 1)
                        .map((instance) =>
                          probeResults[instance.instance_id] ? (
                            <div
                              key={instance.instance_id}
                              role="status"
                              className={
                                probeResults[instance.instance_id].ok
                                  ? styles.probeSuccess
                                  : styles.error
                              }
                            >
                              {probeResults[instance.instance_id].detail}
                            </div>
                          ) : null,
                        )}
                    </article>
                  );
                })
              : (filtered as MarketPlugin[]).map((item) => (
                  <article className={styles.card} key={item.id}>
                    <div className={styles.cardTop}>
                      <span className={styles.glyph}>
                        <Puzzle size={22} />
                      </span>
                      <div className={styles.name}>{item.name || item.id}</div>
                      <Button
                        type="text"
                        icon={<Plus size={16} />}
                        onClick={() => navigate("/admin/plugins?tab=market")}
                        aria-label={word("管理插件", "Manage plugin")}
                      />
                    </div>
                    <p className={styles.desc}>{item.description}</p>
                    <div className={styles.cardFoot}>
                      <span>{item.group || word("插件", "Plugin")}</span>
                      <span>
                        {item.installed
                          ? word("已安装", "Installed")
                          : word("可安装", "Available")}
                      </span>
                    </div>
                  </article>
                ))}
          </div>
        )}
        {tab === "connectors" && customInstances.length ? (
          <section
            className={styles.customSection}
            aria-label={word("自定义连接器", "Custom connectors")}
          >
            <div className={styles.sectionHeading}>
              {word(
                "自定义 MCP（包括 GitHub 等）",
                "Custom MCP (including GitHub)",
              )}
            </div>
            <div className={styles.cards}>
              {customInstances.map((item) => (
                <article className={styles.card} key={item.mcp_server_name}>
                  <div className={styles.cardTop}>
                    <span className={styles.glyph}>
                      <Link2 size={22} />
                    </span>
                    <div className={styles.name}>{item.display_name}</div>
                  </div>
                  <p className={styles.desc}>{item.description || item.kind}</p>
                  <div className={styles.cardFoot}>
                    <span>
                      {item.status === "active" && item.has_credentials
                        ? word(
                            "已配置 · 尚未验证",
                            "Configured · not yet probed",
                          )
                        : word("需授权", "Authorization required")}
                    </span>
                    <Button
                      size="small"
                      disabled={
                        item.status !== "active" || !item.has_credentials
                      }
                      loading={probeBusy === item.instance_id}
                      onClick={() => void probeInstance(item.instance_id)}
                    >
                      {word("验证工具", "Probe tools")}
                    </Button>
                  </div>
                  {probeResults[item.instance_id] ? (
                    <div
                      role="status"
                      className={
                        probeResults[item.instance_id].ok
                          ? styles.probeSuccess
                          : styles.error
                      }
                    >
                      {probeResults[item.instance_id].detail}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        <Modal
          title={word(
            "预览并导入 FreeLLM Skill",
            "Preview and import FreeLLM Skill",
          )}
          open={!!preview || previewBusy}
          onCancel={() => {
            if (!importBusy) {
              setPreview(null);
              setPreviewBusy(false);
            }
          }}
          footer={
            <div className={styles.modalActions}>
              <Button onClick={() => setPreview(null)} disabled={importBusy}>
                {word("取消", "Cancel")}
              </Button>
              <Button
                type="primary"
                icon={<Download size={15} />}
                disabled={!preview || !packageId || importBusy}
                loading={importBusy}
                onClick={() => void importSkill()}
              >
                {word("确认导入", "Confirm import")}
              </Button>
            </div>
          }
          width={820}
          destroyOnHidden
        >
          {previewBusy ? (
            <Spin />
          ) : preview ? (
            <>
              <Typography.Paragraph>{preview.description}</Typography.Paragraph>
              <Typography.Text type="secondary">
                {word("来源", "Source")}:{" "}
                <a
                  href={preview.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {preview.github_url}
                </a>
              </Typography.Text>
              <pre className={styles.preview}>{preview.markdown}</pre>
              <Typography.Paragraph type="warning">
                {word(
                  "外部 Skill 包含可执行指令。请检查来源、许可证、网络权限及潜在的提示词注入。此操作仅复制到技能包，不会自动授权 Agent 执行。",
                  "External Skills can contain executable instructions. Review source, license, permissions, and prompt injection. Importing does not enable this Skill for an agent.",
                )}
              </Typography.Paragraph>
              <Select
                className={styles.packageSelect}
                placeholder={word(
                  "选择目标技能包",
                  "Choose destination package",
                )}
                value={packageId || undefined}
                onChange={setPackageId}
                options={packages.map((pkg) => ({
                  label: pkg.name,
                  value: pkg.id,
                }))}
              />
              {packages.length === 0 ? (
                <Button onClick={() => navigate("/skill-packages/manage")}>
                  {word("先创建技能包", "Create a skill package first")}
                </Button>
              ) : null}
            </>
          ) : null}
        </Modal>
      </div>
    </PageShell>
  );
}
