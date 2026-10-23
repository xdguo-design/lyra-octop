import styles from "./PdfDocumentPreview.module.less";

function PdfLoadingBar({ percent }: { percent?: number | null }) {
  const clamped =
    percent != null && Number.isFinite(percent)
      ? Math.max(2, Math.min(100, Math.round(percent)))
      : null;
  return (
    <div className={styles.pdfLoadingBar} aria-hidden>
      <div
        className={
          clamped != null
            ? styles.pdfLoadingBarFill
            : styles.pdfLoadingBarIndeterminate
        }
        style={clamped != null ? { width: clamped + "%" } : undefined}
      />
    </div>
  );
}

export default function PdfViewerSkeleton({
  percent,
}: {
  percent?: number | null;
}) {
  return (
    <div className={styles.pdfPreview} aria-busy="true">
      <div className={styles.pdfToolbar}>
        <PdfLoadingBar percent={percent} />
      </div>
      <div className={styles.pdfScroll}>
        <div className={styles.skelPage} aria-hidden />
        <div className={styles.skelPage} aria-hidden />
      </div>
    </div>
  );
}
