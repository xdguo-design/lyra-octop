import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { WebSearchSource } from "../../../utils/parseWebSearchSources";
import styles from "./WebSearchSourcesStrip.module.less";

export function WebSearchSourcesStrip({
  sources,
}: {
  sources: WebSearchSource[];
}) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;

  return (
    <section className={styles.sources} aria-label={t("chat.webSources.label")}>
      <div className={styles.heading}>{t("chat.webSources.label")}</div>
      <div className={styles.list}>
        {sources.map((source) => (
          <a
            className={styles.source}
            href={source.url}
            key={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.snippet || source.title}
          >
            <span className={styles.title}>{source.title}</span>
            <span className={styles.provider}>{source.provider}</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}
