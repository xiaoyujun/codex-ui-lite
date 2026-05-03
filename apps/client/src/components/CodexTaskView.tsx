import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Send,
  StopCircle,
  TerminalSquare,
  X
} from "lucide-react";
import type { CodexAttachment, CodexTask, CodexTaskServerMessage, CodexWindow, Project } from "@codex-ui/shared";
import type { Connection } from "../types.js";
import { cancelCodexTask, codexWindowUrl, createCodexTask, uploadCodexAttachment, websocketProtocols } from "../api.js";

type Props = {
  connection: Connection;
  project: Project;
  window: CodexWindow;
  onWindowChange(window: CodexWindow): void;
};

const maxClientAttachmentBytes = 10 * 1024 * 1024;

export function CodexTaskView({ connection, project, window: codexWindow, onWindowChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const codexWindowRef = useRef(codexWindow);
  const onWindowChangeRef = useRef(onWindowChange);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [showLogTaskId, setShowLogTaskId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const runningTask = useMemo(() => codexWindow.tasks.find((task) => task.status === "running"), [codexWindow.tasks]);

  useEffect(() => {
    codexWindowRef.current = codexWindow;
  }, [codexWindow]);

  useEffect(() => {
    onWindowChangeRef.current = onWindowChange;
  }, [onWindowChange]);

  useEffect(() => {
    const socket = new WebSocket(codexWindowUrl(connection, project.id, codexWindow.id), websocketProtocols(connection));

    socket.addEventListener("message", (event) => {
      let message: CodexTaskServerMessage;

      try {
        message = JSON.parse(event.data) as CodexTaskServerMessage;
      } catch {
        return;
      }

      if (message.type === "snapshot" || message.type === "done") {
        codexWindowRef.current = message.window;
        onWindowChangeRef.current(message.window);
        scrollToBottomSoon();
      } else if (message.type === "log") {
        const currentWindow = codexWindowRef.current;
        const nextWindow = {
          ...currentWindow,
          tasks: currentWindow.tasks.map((task) =>
            task.id === message.taskId
              ? {
                  ...task,
                  logTail: appendTail(task.logTail, message.data),
                  updatedAt: new Date().toISOString()
                }
              : task
          )
        };
        codexWindowRef.current = nextWindow;
        onWindowChangeRef.current(nextWindow);
      } else if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("error", () => {
      setError("Codex 窗口连接已断开。");
    });

    return () => socket.close();
  }, [connection.serverUrl, connection.token, project.id, codexWindow.id]);

  useEffect(() => {
    scrollToBottomSoon();
  }, [codexWindow.id]);

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

    if (!nextPrompt || runningTask) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const nextWindow = await createCodexTask(connection, project.id, codexWindow.id, {
        prompt: nextPrompt,
        attachmentIds: attachments.map((attachment) => attachment.id)
      });
      onWindowChange(nextWindow);
      setPrompt("");
      setAttachments([]);
      setShowLogTaskId(undefined);
      scrollToBottomSoon();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法发送到 Codex 窗口。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask(task: CodexTask) {
    setBusy(true);
    setError("");

    try {
      await cancelCodexTask(connection, project.id, codexWindow.id, task.id);
      onWindowChange({
        ...codexWindow,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
        tasks: codexWindow.tasks.map((item) => (item.id === task.id ? { ...item, status: "cancelled" } : item))
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法停止 Codex。");
    } finally {
      setBusy(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function scrollToBottomSoon() {
    globalThis.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  const canSend = Boolean(prompt.trim()) && !busy && !uploading && !runningTask;

  return (
    <section className="codex-window-layout">
      <div className="codex-window-header">
        <div className="section-heading">
          <TerminalSquare size={18} />
          <h2>{codexWindow.title}</h2>
        </div>
        <span className={`codex-task-status ${codexWindow.status}`}>{statusText(codexWindow.status)}</span>
      </div>

      <div ref={scrollRef} className="codex-message-scroll">
        {codexWindow.tasks.length ? (
          codexWindow.tasks.map((task) => (
            <article className="codex-message-group" key={task.id}>
              <div className="codex-message user">
                <div className="codex-message-avatar">你</div>
                <div className="codex-message-body">
                  <pre>{task.prompt}</pre>
                  {task.attachments.length ? <AttachmentStrip attachments={task.attachments} /> : null}
                </div>
              </div>

              <div className="codex-message assistant">
                <div className="codex-message-avatar">
                  <Bot size={16} />
                </div>
                <div className="codex-message-body">
                  <div className="codex-message-meta">
                    {statusIcon(task.status)}
                    <span>{statusText(task.status)}</span>
                    {task.status === "running" ? (
                      <button className="inline-action danger" type="button" onClick={() => cancelTask(task)} disabled={busy}>
                        <StopCircle size={14} />
                        停止
                      </button>
                    ) : null}
                    <button
                      className="inline-action"
                      type="button"
                      onClick={() => setShowLogTaskId((current) => (current === task.id ? undefined : task.id))}
                    >
                      <FileText size={14} />
                      {showLogTaskId === task.id ? "隐藏日志" : "执行日志"}
                    </button>
                  </div>

                  {task.finalMessage ? (
                    <pre className="codex-final-output">{task.finalMessage}</pre>
                  ) : task.status === "running" ? (
                    <div className="codex-inline-running">Codex 正在后台处理，默认不显示思考刷屏。</div>
                  ) : (
                    <div className="codex-inline-running">没有生成最终回复。</div>
                  )}

                  {showLogTaskId === task.id ? (
                    <div className="codex-log-panel">
                      <span>执行日志</span>
                      <pre>{task.logTail || "暂无日志"}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="codex-running-state">
            <Bot size={46} />
            <span>这是一个 Codex 窗口</span>
            <p>像终端窗口一样保留上下文和缓存，但用对话页面显示结果。</p>
          </div>
        )}
      </div>

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
          placeholder={runningTask ? "当前窗口正在运行，完成或停止后可继续发送。" : "给当前 Codex 窗口发送消息，可附加图片或文件。"}
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
            disabled={uploading || Boolean(runningTask)}
          >
            <Paperclip size={16} />
            <span>{uploading ? "上传中" : "上传附件"}</span>
          </button>
          <button className="primary-button compact-button" type="button" onClick={sendTask} disabled={!canSend}>
            <Send size={16} />
            <span>发送</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function AttachmentStrip({ attachments }: { attachments: CodexAttachment[] }) {
  return (
    <div className="codex-attachment-strip message">
      {attachments.map((attachment) => (
        <span className="codex-attachment-chip" key={attachment.id}>
          {attachment.kind === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
          {attachment.name}
        </span>
      ))}
    </div>
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

function statusText(status: CodexTask["status"] | CodexWindow["status"]): string {
  if (status === "idle") {
    return "空闲";
  }

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
