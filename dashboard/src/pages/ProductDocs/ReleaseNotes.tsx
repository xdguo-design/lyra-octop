import Markdown from "../../components/Markdown";
import PageShell from "../../layouts/PageShell";
// Vendored copy of docs/release-notes-2026-10.md — see FeatureOverview.tsx for
// why the repo-root ?raw import cannot be used (Docker build context).
import content from "./content/release-notes-2026-10.md?raw";

export default function ReleaseNotesPage() {
  return (
    <PageShell title="更新日志" subtitle="2026 年 10 月开发批次">
      <Markdown content={content} style={{ overflowX: "auto" }} />
    </PageShell>
  );
}
