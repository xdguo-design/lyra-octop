import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Empty, Input, Spin } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import styles from "./index.module.less";
import {
  filterAndSortResources,
  type ResourceKind,
  type UnifiedResource,
} from "./resourceCatalog";

type ResourceFilter = ResourceKind | "all";

interface UnifiedResourceBrowserProps {
  resources: readonly UnifiedResource[];
  loading: boolean;
  errors: Partial<Record<ResourceKind, string>>;
  availableKinds: ResourceKind[];
  onRetry: (kind: ResourceKind) => void;
  renderResource: (resource: UnifiedResource) => ReactNode;
  toolbarAction?: ReactNode;
}

const filters: Array<{ kind: ResourceFilter; key: string; fallback: string }> =
  [
    { kind: "all", key: "connectors.unified.all", fallback: "全部" },
    { kind: "expert", key: "connectors.unified.experts", fallback: "专家" },
    { kind: "skill", key: "connectors.unified.skills", fallback: "技能" },
    {
      kind: "connector",
      key: "connectors.unified.connectors",
      fallback: "连接器",
    },
  ];

export function UnifiedResourceBrowser({
  resources,
  loading,
  errors,
  availableKinds,
  onRetry,
  renderResource,
  toolbarAction,
}: UnifiedResourceBrowserProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ResourceFilter>("all");
  const visible = useMemo(
    () => filterAndSortResources(resources, query, kind),
    [kind, query, resources],
  );

  return (
    <div className={styles.unifiedCatalog}>
      <div className={styles.unifiedToolbar}>
        <nav
          className={styles.unifiedFilters}
          aria-label={t("connectors.unified.types", "资源类型")}
        >
          {filters
            .filter(
              (filter) =>
                filter.kind === "all" || availableKinds.includes(filter.kind),
            )
            .map((filter) => (
              <button
                key={filter.kind}
                type="button"
                aria-pressed={kind === filter.kind}
                className={
                  kind === filter.kind
                    ? styles.unifiedFilterActive
                    : styles.unifiedFilter
                }
                onClick={() => setKind(filter.kind)}
              >
                {t(filter.key, filter.fallback)}
              </button>
            ))}
        </nav>
        <Input
          type="search"
          aria-label={t("connectors.unified.search", "搜索专家、技能和连接器")}
          placeholder={t("connectors.unified.search", "搜索专家、技能和连接器")}
          prefix={<Search size={15} />}
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={styles.unifiedSearch}
        />
        {toolbarAction}
      </div>

      {(Object.entries(errors) as Array<[ResourceKind, string]>).map(
        ([errorKind, error]) => (
          <Alert
            key={errorKind}
            className={styles.unifiedError}
            type="error"
            showIcon
            message={error}
            action={
              <Button size="small" onClick={() => onRetry(errorKind)}>
                {t("common.refresh", "重试")}
              </Button>
            }
          />
        ),
      )}

      {loading && resources.length === 0 ? (
        <div className={styles.loadingState}>
          <Spin />
        </div>
      ) : visible.length === 0 ? (
        <Empty description={t("connectors.unified.empty", "没有匹配的资源")} />
      ) : (
        <div className={styles.typeGrid} data-testid="unified-resource-grid">
          {visible.map((resource) => (
            <div
              key={resource.key}
              data-resource-kind={resource.kind}
              data-resource-enabled={resource.enabled}
            >
              {renderResource(resource)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
