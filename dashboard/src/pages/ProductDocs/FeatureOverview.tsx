import Markdown from "../../components/Markdown";
import PageShell from "../../layouts/PageShell";
// Vendored copy of docs/features.md: the Docker build context only contains
// dashboard/ (.dockerignore strips root *.md, the Dockerfile never COPYs docs/),
// so a repo-root ?raw import breaks image builds.
import content from "./content/features.md?raw";

const dashboardContent = content
  .replaceAll(
    "(testing/offline-test-guide.md)",
    "(https://github.com/xdguo-design/lyra-octop/blob/dev/docs/testing/offline-test-guide.md)",
  )
  .replaceAll("(release-notes-2026-10.md)", "(/release-notes)");

export default function FeatureOverviewPage() {
  return (
    <PageShell title="功能介绍" subtitle="Lyra Octop 当前已交付能力与使用边界">
      <Markdown content={dashboardContent} style={{ overflowX: "auto" }} />
    </PageShell>
  );
}
