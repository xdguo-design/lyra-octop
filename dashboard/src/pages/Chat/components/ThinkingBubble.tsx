import { useTranslation } from "react-i18next";
import { useElapsedSince } from "../../../hooks/useElapsedSeconds";
import styles from "../index.module.less";

interface ThinkingBubbleProps {
  onCancel?: () => void;
  startedAt: number;
}

export default function ThinkingBubble({
  onCancel,
  startedAt,
}: ThinkingBubbleProps) {
  const { t } = useTranslation();
  // LYRA 统一品牌：思考中的头像与小恐龙空状态同源，不再使用章鱼动画。
  const typingSrc = `${import.meta.env.BASE_URL}lyra-dino.svg`;
  const elapsed = useElapsedSince(startedAt);

  return (
    <div className={styles.thinkingBubble}>
      <div className={styles.avatarCol}>
        <div className={styles.botAvatar}>
          <img src={typingSrc} alt="" aria-hidden draggable={false} />
        </div>
      </div>
      <div className={styles.thinkingContent}>
        <span className={styles.thinkingDot} />
        <span className={styles.thinkingDot} />
        <span className={styles.thinkingDot} />
        <span className={styles.thinkingText}>
          {t("chat.thinking")}
          {` · ${elapsed}s`}
        </span>
        {onCancel && (
          <button
            className={styles.thinkingCancelBtn}
            onClick={onCancel}
            type="button"
            title={t("common.cancel")}
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
