import { useEffect, useState } from "react";
import { Edit3, FolderOpen, Plus, RefreshCw, TerminalSquare, Trash2 } from "lucide-react";
import type { Project } from "@codex-ui/shared";
import type { Connection } from "../types.js";
import { createProject, deleteProject, listProjects, updateProject } from "../api.js";
import { ProjectForm, type ProjectFormValue } from "./ProjectForm.js";

type Props = {
  connection: Connection;
  onOpenProject(project: Project): void;
};

export function ProjectsView({ connection, onOpenProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Project | null | "new">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    refresh();
  }, [connection.serverUrl, connection.token]);

  async function refresh() {
    setBusy(true);
    setError("");

    try {
      setProjects(await listProjects(connection));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法读取项目列表。");
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(value: ProjectFormValue) {
    setBusy(true);
    setError("");

    try {
      if (editing === "new") {
        await createProject(connection, value);
      } else if (editing) {
        await updateProject(connection, editing.id, value);
      }

      setEditing(null);
      setProjects(await listProjects(connection));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法保存项目。");
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: Project) {
    setBusy(true);
    setError("");

    try {
      await deleteProject(connection, project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法删除项目。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="projects-layout">
      <div className="toolbar">
        <div className="section-heading">
          <FolderOpen size={20} />
          <h2>Codex 桌面端项目</h2>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" title="刷新" onClick={refresh} disabled={busy}>
            <RefreshCw size={18} />
          </button>
          <button className="primary-button compact-button" type="button" onClick={() => setEditing("new")}>
            <Plus size={18} />
            <span>添加</span>
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {projects.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={42} />
          <span>还没有可用项目</span>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-main">
                <h3>{project.name}</h3>
                <p>{project.path}</p>
                <span>{project.defaultShell ?? "系统默认 Shell"}</span>
              </div>
              <div className="project-actions">
                <button className="icon-button" type="button" title="编辑" onClick={() => setEditing(project)}>
                  <Edit3 size={17} />
                </button>
                <button className="icon-button danger" type="button" title="从项目列表移除" onClick={() => removeProject(project)}>
                  <Trash2 size={17} />
                </button>
                <button className="primary-button compact-button" type="button" onClick={() => onOpenProject(project)}>
                  <TerminalSquare size={17} />
                  <span>打开项目</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <ProjectForm
          project={editing === "new" ? undefined : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={saveProject}
        />
      ) : null}
    </section>
  );
}
