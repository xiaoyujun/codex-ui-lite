import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Edit3, Eye, FileText, FolderOpen, RefreshCw, Save } from "lucide-react";
import type { Project, ProjectFileEntry, ProjectFileList, ProjectMarkdownFile } from "@codex-ui/shared";
import type { Connection } from "../types.js";
import { listProjectFiles, readProjectMarkdown, saveProjectMarkdown } from "../api.js";

type Props = {
  connection: Connection;
  project: Project;
  onBack(): void;
};

export function FileView({ connection, project, onBack }: Props) {
  const [fileList, setFileList] = useState<ProjectFileList | null>(null);
  const [currentDir, setCurrentDir] = useState("");
  const [activeFile, setActiveFile] = useState<ProjectMarkdownFile | null>(null);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = activeFile ? content !== activeFile.content : false;

  useEffect(() => {
    loadDirectory(currentDir);
  }, [connection.serverUrl, connection.token, project.id, currentDir]);

  async function loadDirectory(dir: string) {
    setBusy(true);
    setError("");

    try {
      setFileList(await listProjectFiles(connection, project.id, dir));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法读取目录。");
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(entry: ProjectFileEntry) {
    if (entry.type === "directory") {
      setCurrentDir(entry.path);
      return;
    }

    setBusy(true);
    setError("");

    try {
      const file = await readProjectMarkdown(connection, project.id, entry.path);
      setActiveFile(file);
      setContent(file.content);
      setMode("edit");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法打开 Markdown 文件。");
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!activeFile) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const saved = await saveProjectMarkdown(connection, project.id, {
        path: activeFile.path,
        content
      });
      setActiveFile(saved);
      setContent(saved.content);
      await loadDirectory(currentDir);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  const currentTitle = useMemo(() => fileList?.path || "项目根目录", [fileList?.path]);

  return (
    <section className="files-layout">
      <div className="toolbar files-toolbar">
        <div className="section-heading">
          <FolderOpen size={20} />
          <h2>{project.name}</h2>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" title="返回项目" onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          <button className="icon-button" type="button" title="刷新目录" onClick={() => loadDirectory(currentDir)} disabled={busy}>
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="files-workspace">
        <aside className="file-browser-panel">
          <div className="file-browser-heading">
            <span>{currentTitle}</span>
            {fileList?.parentPath !== fileList?.path && fileList?.path ? (
              <button className="secondary-button compact-button" type="button" onClick={() => setCurrentDir(fileList.parentPath)}>
                <ArrowLeft size={16} />
                <span>上一级</span>
              </button>
            ) : null}
          </div>

          <div className="file-list">
            {fileList?.entries.length ? (
              fileList.entries.map((entry) => (
                <button
                  className={`file-row ${activeFile?.path === entry.path ? "active" : ""}`}
                  key={entry.path}
                  type="button"
                  onClick={() => openEntry(entry)}
                >
                  {entry.type === "directory" ? <FolderOpen size={17} /> : <FileText size={17} />}
                  <span>{entry.name}</span>
                </button>
              ))
            ) : (
              <div className="file-empty">{busy ? "正在读取..." : "当前目录没有 Markdown 文件"}</div>
            )}
          </div>
        </aside>

        <article className="markdown-editor-panel">
          {activeFile ? (
            <>
              <div className="editor-heading">
                <div className="editor-title">
                  <FileText size={18} />
                  <span>{activeFile.path}</span>
                </div>
                <div className="toolbar-actions">
                  <button
                    className={`secondary-button compact-button ${mode === "edit" ? "selected" : ""}`}
                    type="button"
                    onClick={() => setMode("edit")}
                  >
                    <Edit3 size={16} />
                    <span>编辑</span>
                  </button>
                  <button
                    className={`secondary-button compact-button ${mode === "preview" ? "selected" : ""}`}
                    type="button"
                    onClick={() => setMode("preview")}
                  >
                    <Eye size={16} />
                    <span>预览</span>
                  </button>
                  <button className="primary-button compact-button" type="button" onClick={saveFile} disabled={!dirty || saving}>
                    <Save size={16} />
                    <span>{saving ? "保存中" : dirty ? "保存" : "已保存"}</span>
                  </button>
                </div>
              </div>

              {mode === "edit" ? (
                <textarea className="markdown-textarea" value={content} onChange={(event) => setContent(event.target.value)} />
              ) : (
                <MarkdownPreview content={content} />
              )}
            </>
          ) : (
            <div className="markdown-empty">
              <FileText size={46} />
              <span>选择一个 Markdown 文件开始阅读或编辑</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return <div className="markdown-preview">{renderMarkdown(content)}</div>;
}

function renderMarkdown(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = content.split(/\r?\n/);
  let inCode = false;
  let codeLines: string[] = [];

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(<pre key={`code-${index}`}>{codeLines.join("\n")}</pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      nodes.push(<br key={`br-${index}`} />);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      nodes.push(level === 1 ? <h1 key={index}>{text}</h1> : level === 2 ? <h2 key={index}>{text}</h2> : <h3 key={index}>{text}</h3>);
      return;
    }

    if (/^[-*]\s+/.test(line)) {
      nodes.push(<p className="preview-list-item" key={index}>{line.replace(/^[-*]\s+/, "")}</p>);
      return;
    }

    if (line.startsWith(">")) {
      nodes.push(<blockquote key={index}>{line.replace(/^>\s?/, "")}</blockquote>);
      return;
    }

    nodes.push(<p key={index}>{line}</p>);
  });

  if (codeLines.length > 0) {
    nodes.push(<pre key="code-tail">{codeLines.join("\n")}</pre>);
  }

  return nodes;
}
