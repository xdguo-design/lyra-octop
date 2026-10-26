import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal } from "antd";
import {
  AppWindow,
  CalendarDays,
  ChartColumn,
  Gamepad2,
  Lightbulb,
  Presentation,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import styles from "./WorkbenchHome.module.less";

type CreationType = "miniProgram" | "presentation";

const CREATION_TASKS: Record<
  CreationType,
  Array<{
    titleKey: string;
    descriptionKey: string;
    promptKey: string;
    icon: LucideIcon;
  }>
> = {
  miniProgram: [
    {
      titleKey: "workbench.home.miniShop",
      descriptionKey: "workbench.home.miniShopDesc",
      promptKey: "workbench.home.miniShopPrompt",
      icon: ShoppingBag,
    },
    {
      titleKey: "workbench.home.miniBooking",
      descriptionKey: "workbench.home.miniBookingDesc",
      promptKey: "workbench.home.miniBookingPrompt",
      icon: CalendarDays,
    },
    {
      titleKey: "workbench.home.miniGame",
      descriptionKey: "workbench.home.miniGameDesc",
      promptKey: "workbench.home.miniGamePrompt",
      icon: Gamepad2,
    },
  ],
  presentation: [
    {
      titleKey: "workbench.home.pptProduct",
      descriptionKey: "workbench.home.pptProductDesc",
      promptKey: "workbench.home.pptProductPrompt",
      icon: Presentation,
    },
    {
      titleKey: "workbench.home.pptReport",
      descriptionKey: "workbench.home.pptReportDesc",
      promptKey: "workbench.home.pptReportPrompt",
      icon: ChartColumn,
    },
    {
      titleKey: "workbench.home.pptProposal",
      descriptionKey: "workbench.home.pptProposalDesc",
      promptKey: "workbench.home.pptProposalPrompt",
      icon: Lightbulb,
    },
  ],
};

interface WorkbenchHomeProps {
  /** Browser environment ready (Chromium installed). */
  envReady: boolean;
  /** A browser session is being created. */
  starting: boolean;
  /** Dispatch a task to the current expert's assistant panel. */
  onSubmitTask: (task: string) => void;
  /** Open the planet kids-workbench app panel. */
  onOpenPlanet: () => void;
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
  onStartBrowser,
}: WorkbenchHomeProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [creationType, setCreationType] = useState<CreationType | null>(null);

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

        {/* 工作流卡 = 对话式创建：把引导语派给主 Agent，
            由它问清需求后调 cronjob_create 生成定时任务。 */}
        <button
          type="button"
          className={styles.card}
          onClick={() =>
            onSubmitTask(
              t(
                "workbench.home.flowCreateTask",
                "帮我创建一个定时任务。请先问我要做什么、多久执行一次或具体什么时间执行，确认后用 cronjob_create 工具帮我创建。",
              ),
            )
          }
        >
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

        <button
          type="button"
          className={styles.card}
          onClick={() => setCreationType("miniProgram")}
        >
          <ThumbFrame title={t("workbench.home.cardMiniProgram", "制作小程序")}>
            <span className={styles.thumbSoon}>
              <span
                className={`${styles.thumbSoonIcon} ${styles.creationIcon}`}
              >
                <AppWindow size={18} aria-hidden />
              </span>
              <span className={styles.thumbSoonText}>
                {t(
                  "workbench.home.cardMiniProgramDesc",
                  "商城、预约、互动游戏",
                )}
              </span>
            </span>
          </ThumbFrame>
          <span className={styles.cardTitle}>
            {t("workbench.home.cardMiniProgram", "制作小程序")}
          </span>
          <span className={styles.cardDesc}>
            {t("workbench.home.cardMiniProgramDesc", "商城、预约、互动游戏")}
          </span>
        </button>

        <button
          type="button"
          className={styles.card}
          onClick={() => setCreationType("presentation")}
        >
          <ThumbFrame title={t("workbench.home.cardPresentation", "创建 PPT")}>
            <span className={styles.thumbSoon}>
              <span
                className={`${styles.thumbSoonIcon} ${styles.creationIcon}`}
              >
                <Presentation size={18} aria-hidden />
              </span>
              <span className={styles.thumbSoonText}>
                {t(
                  "workbench.home.cardPresentationDesc",
                  "产品介绍、汇报、方案",
                )}
              </span>
            </span>
          </ThumbFrame>
          <span className={styles.cardTitle}>
            {t("workbench.home.cardPresentation", "创建 PPT")}
          </span>
          <span className={styles.cardDesc}>
            {t("workbench.home.cardPresentationDesc", "产品介绍、汇报、方案")}
          </span>
        </button>
      </div>

      <Modal
        title={
          creationType === "miniProgram"
            ? t("workbench.home.miniProgramDialogTitle", "选择小程序类型")
            : t("workbench.home.presentationDialogTitle", "选择 PPT 类型")
        }
        open={creationType !== null}
        footer={
          <Button onClick={() => setCreationType(null)}>
            {t("common.cancel", "取消")}
          </Button>
        }
        onCancel={() => setCreationType(null)}
        destroyOnClose
      >
        <div className={styles.creationTaskList}>
          {(creationType ? CREATION_TASKS[creationType] : []).map((task) => {
            const Icon = task.icon;
            return (
              <button
                key={task.titleKey}
                type="button"
                className={styles.creationTask}
                onClick={() => {
                  const prompt = t(task.promptKey);
                  setCreationType(null);
                  onSubmitTask(prompt);
                }}
              >
                <span className={styles.creationTaskIcon}>
                  <Icon size={18} aria-hidden />
                </span>
                <span className={styles.creationTaskCopy}>
                  <strong>{t(task.titleKey)}</strong>
                  <small>{t(task.descriptionKey)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>

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
