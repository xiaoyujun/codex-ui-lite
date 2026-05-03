import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Plus, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import type { Project, TerminalSession } from "@codex-ui/shared";
import type { Connection, WorkspaceSnapshot } from "../types.js";
import { closeProjectTerminal, createProjectTerminal, listProjectTerminals } from "../api.js";
import { FileView } from "./FileView.js";
import { TerminalView } from "./TerminalView.js";

type Props = {
  connection: Connection;
  project: Project;
  activeTerminalId?: string;
  onBack(): void;
  onSnapshotChange(snapshot: Omit<WorkspaceSnapshot, "project">): void;
};

export function ProjectWorkspaceView({ connection, project, activeTerminalId, onBack, onSnapshotChange }: Props) {
  const [mode, setMode] = useState<"terminals" | "files">("terminals");
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selectedId, setSelectedId] = useState(activeTerminalId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId]
  );

  const selectedSessionId = selectedSession?.id;

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
        onSnapshotChange({ activeTerminalId: nextSelected });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "无法读取终端窗口。");
      } finally {
        setBusy(false);
      }
    },
    [connection, project.id, selectedId, onSnapshotChange]
  );

  useEffect(() => {
    refreshSessions(true, activeTerminalId);
  }, [connection.serverUrl, connection.token, project.id]);

  async function createTerminal() {
    setBusy(true);
    setError("");

    try {
      const session = await createProjectTerminal(connection, project.id);
      setSessions((current) => [...current, session]);
      setSelectedId(session.id);
      setMode("terminals");
      onSnapshotChange({ activeTerminalId: session.id });
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
      onSnapshotChange({ activeTerminalId: nextSelected });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法关闭终端窗口。");
    } finally {
      setBusy(false);
    }
  }

  function selectSession(session: TerminalSession) {
    setSelectedId(session.id);
    setMode("terminals");
    onSnapshotChange({ activeTerminalId: session.id });
  }

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
          <button className="icon-button" type="button" title="刷新终端窗口" onClick={() => refreshSessions(false)} disabled={busy}>
            <RefreshCw size={18} />
          </button>
          <button className="primary-button compact-button" type="button" onClick={createTerminal} disabled={busy}>
            <Plus size={17} />
            <span>新建终端</span>
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {mode === "files" ? (
        <FileView connection={connection} project={project} onBack={() => setMode("terminals")} />
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
