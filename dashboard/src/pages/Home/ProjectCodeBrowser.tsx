import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Empty, Spin } from "antd";
import { ChevronLeft, FileCode2, Folder, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { workbenchApi, type CodeEntry } from "../../api/modules/workbench";
import "./home-workbench.css";

interface ProjectCodeBrowserProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export default function ProjectCodeBrowser({
  projectId,
  open,
  onClose,
}: ProjectCodeBrowserProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<CodeEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDirectory = useCallback(
    (nextPath: string) => {
      setLoading(true);
      setError("");
      setSelectedFile(null);
      setContent("");
      void workbenchApi
        .listCode(projectId, nextPath)
        .then((result) => {
          setPath(nextPath);
          setEntries(result.entries);
        })
        .catch(() => setError(t("workbench.home.projects.codeUnavailable")))
        .finally(() => setLoading(false));
    },
    [projectId, t],
  );

  useEffect(() => {
    if (open) loadDirectory(".");
  }, [loadDirectory, open]);

  const openEntry = (entry: CodeEntry) => {
    if (entry.is_directory) {
      loadDirectory(entry.path);
      return;
    }
    setLoading(true);
    setError("");
    setSelectedFile(entry.path);
    void workbenchApi
      .readCodeFile(projectId, entry.path)
      .then((file) => setContent(file.content))
      .catch(() => setError(t("workbench.home.projects.fileUnavailable")))
      .finally(() => setLoading(false));
  };

  const parentPath =
    path === "." ? null : path.split("/").slice(0, -1).join("/") || ".";

  return (
    <Drawer
      title={t("workbench.home.projects.codeTitle")}
      open={open}
      onClose={onClose}
      width="min(900px, 100vw)"
      destroyOnClose
      extra={
        <Button
          aria-label={t("workbench.home.projects.refresh")}
          icon={<RotateCw size={15} />}
          onClick={() => loadDirectory(path)}
        />
      }
    >
      <div className="wb-code-browser">
        <aside className="wb-code-tree" aria-label="项目文件">
          <div className="wb-code-tree-header">
            {parentPath && (
              <Button
                size="small"
                icon={<ChevronLeft size={14} />}
                onClick={() => loadDirectory(parentPath)}
              >
                {t("workbench.home.projects.previousLevel")}
              </Button>
            )}
            <span>{path === "." ? "星球" : path}</span>
          </div>
          {loading && !selectedFile ? <Spin size="small" /> : null}
          {error ? (
            <p className="wb-code-error">
              {t("workbench.home.projects.codeUnavailable")}
            </p>
          ) : null}
          {!loading && !error && entries.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("workbench.home.projects.noSource")}
            />
          ) : null}
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.path}
              className={
                "wb-code-entry" +
                (selectedFile === entry.path ? " is-selected" : "")
              }
              onClick={() => openEntry(entry)}
            >
              {entry.is_directory ? (
                <Folder size={15} />
              ) : (
                <FileCode2 size={15} />
              )}
              <span>{entry.name}</span>
            </button>
          ))}
        </aside>
        <section className="wb-code-preview" aria-label="源码预览">
          {selectedFile ? (
            <div className="wb-code-file-path">{selectedFile}</div>
          ) : null}
          {loading && selectedFile ? <Spin /> : null}
          {error && selectedFile ? (
            <p className="wb-code-error">
              {t("workbench.home.projects.fileUnavailable")}
            </p>
          ) : null}
          {!selectedFile ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("workbench.home.projects.selectFile")}
            />
          ) : null}
          {selectedFile && !loading && !error ? <pre>{content}</pre> : null}
        </section>
      </div>
    </Drawer>
  );
}
