import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, FileText, Plus, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import type { CodexWindow, Project, TerminalSession } from "@codex-ui/shared";
import type { Connection, WorkspaceSnapshot } from "../types.js";
import {
  closeCodexWindow,
  closeProjectTerminal,
  createCodexWindow,
  createProjectTerminal,
  listCodexWindows,
  listProjectTerminals
} from "../api.js";
import { CodexTaskView } from "./CodexTaskView.js";
import { FileView } from "./FileView.js";
import { TerminalView } from "./TerminalView.js";

type Props = {
  connection: Connection;
  project: Project;
  activeTerminalId?: string;
  activeCodexWindowId?: string;
  onBack(): void;
  onSnapshotChange(snapshot: Omit<WorkspaceSnapshot, "project">): void;
};

export function ProjectWorkspaceView({
  connection,
  project,
  activeTerminalId,
  activeCodexWindowId,
  onBack,
  onSnapshotChange
}: Props) {
  const [mode, setMode] = useState<"codex" | "terminals" | "files">("codex");
  const [codexWindows, setCodexWindows] = useState<CodexWindow[]>([]);
  const [selectedCodexWindowId, setSelectedCodexWindowId] = useState(activeCodexWindowId);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selectedId, setSelectedId] = useState(activeTerminalId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId]
  );
  const selectedCodexWindow = useMemo(
    () => codexWindows.find((window) => window.id === selectedCodexWindowId) ?? codexWindows[0],
    [codexWindows, selectedCodexWindowId]
  );

  const selectedSessionId = selectedSession?.id;
  const selectedCodexWindowIdValue = selectedCodexWindow?.id;

  const refreshCodexWindows = useCallback(
    async (ensureOne = false, preferredId?: string) => {
      setBusy(true);
      setError("");

      try {
        let nextWindows = await listCodexWindows(connection, project.id);

        if (ensureOne && nextWindows.length === 0) {
          const created = await createCodexWindow(connection, project.id);
          nextWindows = [created];
        }

        const nextSelected =
          nextWindows.find((window) => window.id === preferredId)?.id ??
          nextWindows.find((window) => window.id === selectedCodexWindowId)?.id ??
          nextWindows[0]?.id;

        setCodexWindows(nextWindows);
        setSelectedCodexWindowId(nextSelected);
        onSnapshotChange({ activeTerminalId: selectedId, activeCodexWindowId: nextSelected });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "无法读取 Codex 窗口。");
      } finally {
        setBusy(false);
      }
    },
    [connection, project.id, selectedCodexWindowId, selectedId, onSnapshotChange]
  );

  const refreshSessions = useCallback(
    async (ensureOne = false, preferredId?: string) => {
      setBusy(true);
      setError("");

      try {
        let nextSessions = await listProjectTerminals(connection, project.id);

        if (ensureOne && nextSessions.length === 0) {
          const created = await createProjectTerminal(connection, project.id);
          nextSessions = [created];
        }

        const nextSelected =
          nextSessions.find((session) => session.id === preferredId)?.id ??
          nextSessions.find((session) => session.id === selectedId)?.id ??
          nextSessions[0]?.id;

        setSessions(nextSessions);
        setSelectedId(nextSelected);
        onSnapshotChange({ activeTerminalId: nextSelected, activeCodexWindowId: selectedCodexWindowIdValue });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "无法读取终端窗口。");
      } finally {
        setBusy(false);
      }
    },
    [connection, project.id, selectedId, selectedCodexWindowIdValue, onSnapshotChange]
  );

  useEffect(() => {
    refreshSessions(false, activeTerminalId);
    refreshCodexWindows(true, activeCodexWindowId);
  }, [connection.serverUrl, connection.token, project.id]);

  useEffect(() => {
    if (mode === "terminals" && sessions.length === 0 && !busy) {
      refreshSessions(true, activeTerminalId);
    }
  }, [mode]);

  async function createTerminal() {
    setBusy(true);
    setError("");

    try {
      const session = await createProjectTerminal(connection, project.id);
      setSessions((current) => [...current, session]);
      setSelectedId(session.id);
      setMode("terminals");
      onSnapshotChange({ activeTerminalId: session.id, activeCodexWindowId: selectedCodexWindowIdValue });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法创建终端窗口。");
    } finally {
      setBusy(false);
    }
  }

  async function closeTerminal(session: TerminalSession) {
    setBusy(true);
    setError("");

    try {
      await closeProjectTerminal(connection, project.id, session.id);
      const remaining = sessions.filter((item) => item.id !== session.id);
      const nextSelected = selectedId === session.id ? remaining[0]?.id : selectedId;
      setSessions(remaining);
      setSelectedId(nextSelected);
      onSnapshotChange({ activeTerminalId: nextSelected, activeCodexWindowId: selectedCodexWindowIdValue });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法关闭终端窗口。");
    } finally {
      setBusy(false);
    }
  }

  function selectSession(session: TerminalSession) {
    setSelectedId(session.id);
    setMode("terminals");
    onSnapshotChange({ activeTerminalId: session.id, activeCodexWindowId: selectedCodexWindowIdValue });
  }

  async function createCodexWindowTab() {
    setBusy(true);
    setError("");

    try {
      const window = await createCodexWindow(connection, project.id);
      setCodexWindows((current) => [...current, window]);
      setSelectedCodexWindowId(window.id);
      setMode("codex");
      onSnapshotChange({ activeTerminalId: selectedId, activeCodexWindowId: window.id });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法创建 Codex 窗口。");
    } finally {
      setBusy(false);
    }
  }

  async function closeCodexWindowTab(window: CodexWindow) {
    setBusy(true);
    setError("");

    try {
      await closeCodexWindow(connection, project.id, window.id);
      const remaining = codexWindows.filter((item) => item.id !== window.id);
      const nextSelected = selectedCodexWindowId === window.id ? remaining[0]?.id : selectedCodexWindowId;
      setCodexWindows(remaining);
      setSelectedCodexWindowId(nextSelected);
      onSnapshotChange({ activeTerminalId: selectedId, activeCodexWindowId: nextSelected });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法关闭 Codex 窗口。");
    } finally {
      setBusy(false);
    }
  }

  function selectCodexWindow(window: CodexWindow) {
    setSelectedCodexWindowId(window.id);
    setMode("codex");
    onSnapshotChange({ activeTerminalId: selectedId, activeCodexWindowId: window.id });
  }

  const handleCodexWindowChange = useCallback((nextWindow: CodexWindow) => {
    setCodexWindows((current) => current.map((item) => (item.id === nextWindow.id ? nextWindow : item)));
  }, []);

  const handleSessionUpdate = useCallback(() => {
    if (selectedSessionId) {
      refreshSessions(false, selectedSessionId);
    }
  }, [refreshSessions, selectedSessionId]);

  return (
    <section className="workspace-layout">
      <div className="toolbar workspace-toolbar">
        <div className="section-heading">
          <SquareTerminal size={20} />
          <h2>{project.name}</h2>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" title="返回项目列表" onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          <button
            className={`secondary-button compact-button ${mode === "files" ? "selected" : ""}`}
            type="button"
            onClick={() => setMode("files")}
          >
            <FileText size={17} />
            <span>查看文件夹</span>
          </button>
          <button
            className={`secondary-button compact-button ${mode === "codex" ? "selected" : ""}`}
            type="button"
            onClick={() => setMode("codex")}
          >
            <Bot size={17} />
            <span>Codex 页面</span>
          </button>
          <button
            className={`secondary-button compact-button ${mode === "terminals" ? "selected" : ""}`}
            type="button"
            onClick={() => setMode("terminals")}
          >
            <SquareTerminal size={17} />
            <span>打开终端</span>
          </button>
          <button className="icon-button" type="button" title="刷新终端窗口" onClick={() => refreshSessions(false)} disabled={busy}>
            <RefreshCw size={18} />
          </button>
          {mode === "codex" ? (
            <button className="primary-button compact-button" type="button" onClick={createCodexWindowTab} disabled={busy}>
              <Plus size={17} />
              <span>新建 Codex</span>
            </button>
          ) : (
            <button className="primary-button compact-button" type="button" onClick={createTerminal} disabled={busy}>
              <Plus size={17} />
              <span>新建终端</span>
            </button>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {mode === "codex" ? (
        <div className="codex-window-workspace">
          <div className="terminal-tabs" role="tablist" aria-label="Codex 窗口">
            {codexWindows.map((window) => (
              <div className={`terminal-tab ${selectedCodexWindow?.id === window.id ? "active" : ""}`} key={window.id}>
                <button type="button" onClick={() => selectCodexWindow(window)}>
                  <Bot size={15} />
                  <span>{window.title}</span>
                  {window.status === "running" ? <em>运行中</em> : null}
                </button>
                <button className="terminal-tab-close" type="button" title="关闭 Codex 窗口" onClick={() => closeCodexWindowTab(window)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {selectedCodexWindow ? (
            <CodexTaskView
              connection={connection}
              project={project}
              window={selectedCodexWindow}
              onWindowChange={handleCodexWindowChange}
            />
          ) : (
            <div className="empty-state terminal-empty">
              <Bot size={42} />
              <span>当前项目还没有 Codex 窗口</span>
              <button className="primary-button compact-button" type="button" onClick={createCodexWindowTab} disabled={busy}>
                <Plus size={17} />
                <span>新建 Codex</span>
              </button>
            </div>
          )}
        </div>
      ) : mode === "files" ? (
        <FileView connection={connection} project={project} onBack={() => setMode("codex")} />
      ) : (
        <div className="terminal-workspace">
          <div className="terminal-tabs" role="tablist" aria-label="终端窗口">
            {sessions.map((session) => (
              <div className={`terminal-tab ${selectedSession?.id === session.id ? "active" : ""}`} key={session.id}>
                <button type="button" onClick={() => selectSession(session)}>
                  <SquareTerminal size={15} />
                  <span>{session.title}</span>
                  {session.status === "exited" ? <em>已退出</em> : null}
                </button>
                <button className="terminal-tab-close" type="button" title="关闭终端窗口" onClick={() => closeTerminal(session)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {selectedSession ? (
            <TerminalView
              connection={connection}
              project={project}
              session={selectedSession}
              onSessionUpdate={handleSessionUpdate}
            />
          ) : (
            <div className="empty-state terminal-empty">
              <SquareTerminal size={42} />
              <span>当前项目还没有终端窗口</span>
              <button className="primary-button compact-button" type="button" onClick={createTerminal} disabled={busy}>
                <Plus size={17} />
                <span>新建终端</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
