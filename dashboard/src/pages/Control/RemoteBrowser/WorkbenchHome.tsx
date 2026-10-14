import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import styles from "./WorkbenchHome.module.less";

interface WorkbenchHomeProps {
  /** Browser environment ready (Chromium installed). */
  envReady: boolean;
  /** A browser session is being created. */
  starting: boolean;
  /** Dispatch a task to the main agent (opens the real chat page). */
  onSubmitTask: (task: string) => void;
  /** Open the planet kids-workbench app panel. */
  onOpenPlanet: () => void;
  /** Navigate to the tasks / workflow page. */
  onOpenTasks: () => void;
  /** Start a browser session directly. */
  onStartBrowser: () => void;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mini browser window that hosts a real page thumbnail. */
function ThumbFrame({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={styles.thumbFrame}>
      <span className={styles.thumbBar}>
        <span className={styles.thumbDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.thumbTitle}>{title}</span>
      </span>
      <span className={styles.thumbViewport}>{children}</span>
    </span>
  );
}

export default function WorkbenchHome({
  envReady,
  starting,
  onSubmitTask,
  onOpenPlanet,
  onOpenTasks,
  onStartBrowser,
}: WorkbenchHomeProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const task = draft.trim();
    if (!task) return;
    setDraft("");
    onSubmitTask(task);
  };

  const placeholder = t(
    "workbench.home.inputPlaceholder",
    "分配一个任务，或输入 / 查看工作台",
  );

  return (
    <div className={styles.home}>
      <div className={styles.hero}>
        <h1 className={styles.title}>
          {t("workbench.home.title", "你的")}
          <span className={styles.titleAccent}>
            {t("workbench.home.titleAccent", "AI 工作台")}
          </span>
        </h1>
        <p className={styles.subtitle}>
          {t("workbench.home.subtitle", "把复杂的工作，交给 AI 来处理")}
        </p>
      </div>

      <form className={styles.askBox} onSubmit={submit}>
        <input
          className={styles.askInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button
          className={styles.askSend}
          type="submit"
          disabled={!draft.trim()}
          aria-label={t("workbench.home.send", "发送")}
          title={t("workbench.home.send", "发送")}
        >
          <SendIcon />
        </button>
      </form>

      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={onOpenPlanet}>
          <ThumbFrame title={t("workbench.home.cardPlanet", "星球乐园")}>
            <img
              className={styles.thumbImg}
              src="/workbench/thumbs/planet.png"
              alt=""
              loading="lazy"
              draggable={false}
            />
          </ThumbFrame>
          <span className={styles.cardTitle}>
            {t("workbench.home.cardPlanet", "星球乐园")}
          </span>
          <span className={styles.cardDesc}>
            {t("workbench.home.cardPlanetDesc", "儿童数学工作台")}
          </span>
        </button>

        <button type="button" className={styles.card} onClick={onOpenTasks}>
          <ThumbFrame title={t("workbench.home.cardFlow", "工作流")}>
            <img
              className={styles.thumbImg}
              src="/workbench/thumbs/tasks.png"
              alt=""
              loading="lazy"
              draggable={false}
            />
          </ThumbFrame>
          <span className={styles.cardTitle}>
            {t("workbench.home.cardFlow", "工作流")}
          </span>
          <span className={styles.cardDesc}>
            {t("workbench.home.cardFlowDesc", "定时任务与自动化")}
          </span>
        </button>

        <span className={`${styles.card} ${styles.cardSoon}`}>
          <ThumbFrame title={t("workbench.home.cardMore", "更多工作台")}>
            <span className={styles.thumbSoon}>
              <span className={styles.thumbSoonIcon}>
                <PlusIcon />
              </span>
              <span className={styles.thumbSoonText}>
                {t("workbench.home.cardMoreDesc", "敬请期待")}
              </span>
            </span>
          </ThumbFrame>
          <span className={styles.cardTitle}>
            {t("workbench.home.cardMore", "更多工作台")}
          </span>
          <span className={styles.cardDesc}>
            {t("workbench.home.cardMoreDesc", "敬请期待")}
          </span>
        </span>
      </div>

      <button
        type="button"
        className={styles.startBrowser}
        onClick={onStartBrowser}
        disabled={starting}
      >
        {envReady
          ? t("workbench.home.startBrowser", "直接启动浏览器，操控网页")
          : t("workbench.home.installBrowser", "先安装浏览器环境，再操控网页")}
        <span className={styles.startArrow}>→</span>
      </button>
    </div>
  );
}
