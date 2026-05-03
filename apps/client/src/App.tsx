import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { LogOut, Monitor, Smartphone, TerminalSquare } from "lucide-react";
import type { Connection, View, WorkspaceSnapshot } from "./types.js";
import {
  clearConnection,
  clearWorkspaceSnapshot,
  loadConnection,
  loadWorkspaceSnapshot,
  saveConnection,
  saveWorkspaceSnapshot
} from "./storage.js";
import { logout } from "./api.js";
import { LoginView } from "./components/LoginView.js";
import { ProjectsView } from "./components/ProjectsView.js";

const ProjectWorkspaceView = lazy(() =>
  import("./components/ProjectWorkspaceView.js").then((module) => ({
    default: module.ProjectWorkspaceView
  }))
);

export function App() {
  const [connection, setConnection] = useState<Connection | undefined>();
  const [view, setView] = useState<View>({ name: "login" });
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadConnection(), loadWorkspaceSnapshot()])
      .then(([stored, snapshot]) => {
        if (stored) {
          setConnection(stored);
          setWorkspaceSnapshot(snapshot);
          setView(snapshot?.project ? { name: "workspace", project: snapshot.project } : { name: "projects" });
        }
      })
      .finally(() => setReady(true));
  }, []);

  const subtitle = useMemo(() => {
    if (!connection) {
      return "账号密码登录";
    }

    if (view.name === "workspace") {
      return view.project.name;
    }

    return `${connection.username ?? "已登录"} · ${connection.serverUrl}`;
  }, [connection, view]);

  async function handleConnected(next: Connection) {
    await saveConnection(next);
    setConnection(next);
    setView({ name: "projects" });
  }

  async function handleDisconnect() {
    if (connection) {
      await logout(connection).catch(() => undefined);
    }
    await clearConnection();
    await clearWorkspaceSnapshot();
    setConnection(undefined);
    setView({ name: "login" });
  }

  async function handleOpenProject(project: WorkspaceSnapshot["project"]) {
    if (!project) {
      return;
    }

    await saveWorkspaceSnapshot({ project });
    setWorkspaceSnapshot({ project });
    setView({ name: "workspace", project });
  }

  async function handleBackToProjects() {
    await clearWorkspaceSnapshot();
    setWorkspaceSnapshot(undefined);
    setView({ name: "projects" });
  }

  async function handleWorkspaceSnapshot(snapshot: Omit<WorkspaceSnapshot, "project">) {
    if (view.name !== "workspace") {
      return;
    }

    const next = { project: view.project, ...snapshot };
    setWorkspaceSnapshot(next);
    await saveWorkspaceSnapshot(next);
  }

  if (!ready) {
    return <div className="loading">正在加载</div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <TerminalSquare size={20} />
          </div>
          <div>
            <h1>Codex 项目终端</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="topbar-actions">
          {connection ? (
            <button className="icon-button" type="button" title="退出登录" onClick={handleDisconnect}>
              <LogOut size={18} />
            </button>
          ) : (
            <div className="status-pill">
              <Smartphone size={15} />
              <span>手机端</span>
            </div>
          )}
        </div>
      </header>

      <main className="content">
        {!connection || view.name === "login" ? (
          <LoginView onConnected={handleConnected} />
        ) : view.name === "projects" ? (
          <ProjectsView connection={connection} onOpenProject={handleOpenProject} />
        ) : (
          <Suspense fallback={<div className="loading">正在加载项目</div>}>
            <ProjectWorkspaceView
              connection={connection}
              project={view.project}
              activeTerminalId={workspaceSnapshot?.activeTerminalId}
              onBack={handleBackToProjects}
              onSnapshotChange={handleWorkspaceSnapshot}
            />
          </Suspense>
        )}
      </main>

      <footer className="bottom-status">
        <span>
          <Monitor size={14} />
          当前电脑执行终端
        </span>
        <span>项目来自 Codex 桌面端</span>
      </footer>
    </div>
  );
}
