import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  Send,
  StopCircle,
  X
} from "lucide-react";
import type { CodexAttachment, CodexTask, CodexTaskServerMessage, Project } from "@codex-ui/shared";
import type { Connection } from "../types.js";
import {
  cancelCodexTask,
  codexTaskUrl,
  createCodexTask,
  listCodexTasks,
  uploadCodexAttachment
} from "../api.js";

type Props = {
  connection: Connection;
  project: Project;
};

const maxClientAttachmentBytes = 10 * 1024 * 1024;

export function CodexTaskView({ connection, project }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [tasks, setTasks] = useState<CodexTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks[0],
    [activeTaskId, tasks]
  );

  useEffect(() => {
    refreshTasks();
  }, [connection.serverUrl, connection.token, project.id]);

  useEffect(() => {
    if (!activeTask || activeTask.status !== "running") {
      return;
    }

    const socket = new WebSocket(codexTaskUrl(connection, project.id, activeTask.id));

    socket.addEventListener("message", (event) => {
      let message: CodexTaskServerMessage;

      try {
        message = JSON.parse(event.data) as CodexTaskServerMessage;
      } catch {
        return;
      }

      if (message.type === "snapshot" || message.type === "done") {
        upsertTask(message.task);
      } else if (message.type === "log") {
        updateTaskLog(message.taskId, message.data);
      } else if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("error", () => {
      setError("Codex 任务连接已断开。");
    });

    return () => socket.close();
  }, [connection.serverUrl, connection.token, project.id, activeTask?.id, activeTask?.status]);

  async function refreshTasks() {
    setBusy(true);
    setError("");

    try {
      const nextTasks = await listCodexTasks(connection, project.id);
      setTasks(nextTasks);
      setActiveTaskId((current) => current ?? nextTasks[0]?.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法读取 Codex 任务。");
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setUploading(true);
    setError("");

    try {
      const uploaded: CodexAttachment[] = [];

      for (const file of Array.from(files)) {
        if (file.size > maxClientAttachmentBytes) {
          throw new Error(`${file.name} 超过 10MB，已拒绝上传。`);
        }

        uploaded.push(
          await uploadCodexAttachment(connection, project.id, {
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            data: await fileToBase64(file)
          })
        );
      }

      setAttachments((current) => [...current, ...uploaded]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "附件上传失败。");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function sendTask() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const created = await createCodexTask(connection, project.id, {
        prompt: nextPrompt,
        attachmentIds: attachments.map((attachment) => attachment.id)
      });
      setTasks((current) => [created, ...current]);
      setActiveTaskId(created.id);
      setPrompt("");
      setAttachments([]);
      setShowLog(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法创建 Codex 任务。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask(task: CodexTask) {
    setBusy(true);
    setError("");

    try {
      await cancelCodexTask(connection, project.id, task.id);
      upsertTask({ ...task, status: "cancelled", updatedAt: new Date().toISOString() });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法取消 Codex 任务。");
    } finally {
      setBusy(false);
    }
  }

  function upsertTask(nextTask: CodexTask) {
    setTasks((current) => {
      const exists = current.some((task) => task.id === nextTask.id);
      return exists ? current.map((task) => (task.id === nextTask.id ? nextTask : task)) : [nextTask, ...current];
    });
  }

  function updateTaskLog(taskId: string, data: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              logTail: appendTail(task.logTail, data),
              updatedAt: new Date().toISOString()
            }
          : task
      )
    );
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  const canSend = Boolean(prompt.trim()) && !busy && !uploading;

  return (
    <section className="codex-task-layout">
      <aside className="codex-task-sidebar">
        <div className="codex-task-sidebar-heading">
          <span>任务记录</span>
          <button className="icon-button" type="button" title="刷新任务" onClick={refreshTasks} disabled={busy}>
            <RefreshCw size={17} />
          </button>
        </div>

        <div className="codex-task-list">
          {tasks.length ? (
            tasks.map((task) => (
              <button
                className={`codex-task-row ${activeTask?.id === task.id ? "active" : ""}`}
                key={task.id}
                type="button"
                onClick={() => setActiveTaskId(task.id)}
              >
                {statusIcon(task.status)}
                <span>{task.prompt}</span>
                <em>{statusText(task.status)}</em>
              </button>
            ))
          ) : (
            <div className="codex-task-empty">还没有任务</div>
          )}
        </div>
      </aside>

      <div className="codex-task-main">
        <article className="codex-answer-panel">
          {activeTask ? (
            <>
              <div className="codex-answer-heading">
                <div>
                  <span className={`codex-task-status ${activeTask.status}`}>{statusText(activeTask.status)}</span>
                  <h3>{activeTask.prompt}</h3>
                </div>
                <div className="toolbar-actions">
                  <button className="secondary-button compact-button" type="button" onClick={() => setShowLog((value) => !value)}>
                    <FileText size={16} />
                    <span>{showLog ? "隐藏执行日志" : "显示执行日志"}</span>
                  </button>
                  {activeTask.status === "running" ? (
                    <button className="secondary-button compact-button danger" type="button" onClick={() => cancelTask(activeTask)} disabled={busy}>
                      <StopCircle size={16} />
                      <span>停止</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {activeTask.attachments.length ? (
                <div className="codex-attachment-strip">
                  {activeTask.attachments.map((attachment) => (
                    <span className="codex-attachment-chip" key={attachment.id}>
                      {attachment.kind === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
                      {attachment.name}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="codex-answer-scroll">
                {activeTask.finalMessage ? (
                  <pre className="codex-final-output">{activeTask.finalMessage}</pre>
                ) : activeTask.status === "running" ? (
                  <div className="codex-running-state">
                    <Bot size={40} />
                    <span>Codex 正在后台处理</span>
                    <p>默认隐藏思考过程和执行日志，避免页面刷屏。</p>
                  </div>
                ) : (
                  <div className="codex-running-state">
                    <AlertTriangle size={40} />
                    <span>没有生成最终回复</span>
                  </div>
                )}

                {showLog ? (
                  <div className="codex-log-panel">
                    <span>执行日志</span>
                    <pre>{activeTask.logTail || "暂无日志"}</pre>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="codex-running-state">
              <Bot size={46} />
              <span>给 Codex 一个任务</span>
              <p>这里不是终端视图，最终结果会以阅读页面展示。</p>
            </div>
          )}
        </article>

        <div className="codex-composer">
          {error ? <p className="error-text">{error}</p> : null}

          {attachments.length ? (
            <div className="codex-attachment-strip draft">
              {attachments.map((attachment) => (
                <span className="codex-attachment-chip" key={attachment.id}>
                  {attachment.kind === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
                  {attachment.name}
                  <button type="button" title="移除附件" onClick={() => removeAttachment(attachment.id)}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            className="codex-prompt-input"
            placeholder="描述你要 Codex 完成的任务，可以附加图片、Markdown、日志或代码文件。"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />

          <div className="codex-composer-actions">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="visually-hidden"
              accept="image/*,.md,.txt,.json,.yaml,.yml,.csv,.log,.js,.jsx,.ts,.tsx,.py,.java,.xml,.html,.css"
              onChange={(event) => handleFiles(event.currentTarget.files)}
            />
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip size={16} />
              <span>{uploading ? "上传中" : "上传附件"}</span>
            </button>
            <button className="primary-button compact-button" type="button" onClick={sendTask} disabled={!canSend}>
              <Send size={16} />
              <span>发送给 Codex</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function statusIcon(status: CodexTask["status"]) {
  if (status === "completed") {
    return <CheckCircle2 size={16} />;
  }

  if (status === "running") {
    return <Clock size={16} />;
  }

  return <AlertTriangle size={16} />;
}

function statusText(status: CodexTask["status"]): string {
  if (status === "running") {
    return "运行中";
  }

  if (status === "completed") {
    return "已完成";
  }

  if (status === "cancelled") {
    return "已停止";
  }

  return "失败";
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function appendTail(current: string, data: string): string {
  const next = current + data;
  return next.length > 500_000 ? next.slice(next.length - 500_000) : next;
}
