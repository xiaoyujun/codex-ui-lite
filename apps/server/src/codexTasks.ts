import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodexAttachment,
  CodexTask,
  CodexTaskServerMessage,
  CodexTaskStatus,
  CodexWindow,
  CreateCodexTaskRequest,
  CreateCodexWindowRequest,
  Project,
  UploadCodexAttachmentRequest
} from "@codex-ui/shared";
import type { WebSocket } from "ws";
import type { ServerConfig } from "./config.js";

type CodexTaskRuntime = CodexTask & {
  process?: ChildProcessWithoutNullStreams;
  outputFile: string;
};

type CodexWindowRuntime = Omit<CodexWindow, "tasks"> & {
  tasks: CodexTaskRuntime[];
  sockets: Set<WebSocket>;
};

const attachments = new Map<string, CodexAttachment>();
const windows = new Map<string, CodexWindowRuntime>();
const maxAttachmentBytes = 10 * 1024 * 1024;
const logTailLimit = 500_000;

export async function saveCodexAttachment(
  project: Project,
  config: ServerConfig,
  input: UploadCodexAttachmentRequest
): Promise<CodexAttachment> {
  const name = sanitizeFileName(input.name);
  const data = Buffer.from(input.data, "base64");

  if (!name) {
    throw new Error("附件名称不能为空。");
  }

  if (data.length === 0) {
    throw new Error("附件内容不能为空。");
  }

  if (data.length > maxAttachmentBytes) {
    throw new Error("单个附件不能超过 10MB。");
  }

  const id = `a_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const directory = path.join(config.dataDir, "codex-attachments", project.id, id);
  const absolutePath = path.join(directory, name);
  const now = new Date().toISOString();
  const attachment: CodexAttachment = {
    id,
    projectId: project.id,
    name,
    path: absolutePath,
    mimeType: input.mimeType || "application/octet-stream",
    size: data.length,
    kind: input.mimeType.toLowerCase().startsWith("image/") ? "image" : "file",
    createdAt: now
  };

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolutePath, data);
  attachments.set(id, attachment);

  return attachment;
}

export function listCodexWindows(projectId: string): CodexWindow[] {
  return [...windows.values()]
    .filter((window) => window.projectId === projectId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(toWindow);
}

export function createCodexWindow(project: Project, input: CreateCodexWindowRequest = {}): CodexWindow {
  const now = new Date().toISOString();
  const window: CodexWindowRuntime = {
    id: `cw_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
    projectId: project.id,
    title: normalizeTitle(input.title) ?? nextWindowTitle(project.id),
    status: "idle",
    tasks: [],
    sockets: new Set(),
    createdAt: now,
    updatedAt: now
  };

  windows.set(window.id, window);
  return toWindow(window);
}

export function closeCodexWindow(projectId: string, windowId: string): boolean {
  const window = windows.get(windowId);

  if (!window || window.projectId !== projectId) {
    return false;
  }

  for (const task of window.tasks) {
    if (task.status === "running") {
      disposeProcess(task.process);
      task.status = "cancelled";
    }
  }

  for (const socket of window.sockets) {
    socket.close();
  }

  window.sockets.clear();
  windows.delete(windowId);
  return true;
}

export async function createCodexTask(
  project: Project,
  config: ServerConfig,
  windowId: string,
  input: CreateCodexTaskRequest
): Promise<CodexWindow> {
  const window = windows.get(windowId);

  if (!window || window.projectId !== project.id) {
    throw new Error("Codex 窗口不存在或不属于当前项目。");
  }

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("请输入要交给 Codex 的任务。");
  }

  const selectedAttachments = resolveAttachments(project.id, input.attachmentIds ?? []);
  const id = `ct_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const now = new Date().toISOString();
  const outputDirectory = path.join(config.dataDir, "codex-task-output");
  const outputFile = path.join(outputDirectory, `${id}.md`);
  const task: CodexTaskRuntime = {
    id,
    projectId: project.id,
    windowId: window.id,
    prompt,
    attachments: selectedAttachments,
    status: "running",
    finalMessage: undefined,
    logTail: "",
    outputFile,
    createdAt: now,
    updatedAt: now
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  window.tasks.push(task);
  touchWindow(window, "running");
  broadcast(window, { type: "snapshot", window: toWindow(window) });
  startCodex(project, config, window, task);

  return toWindow(window);
}

export function cancelCodexTask(projectId: string, windowId: string, taskId: string): boolean {
  const window = windows.get(windowId);
  const task = window?.tasks.find((item) => item.id === taskId);

  if (!window || window.projectId !== projectId || !task) {
    return false;
  }

  if (task.status === "running") {
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    disposeProcess(task.process);
    touchWindow(window);
    broadcast(window, { type: "done", window: toWindow(window), task: toTask(task) });
  }

  return true;
}

export function attachCodexWindow(socket: WebSocket, project: Project, windowId: string): void {
  const window = windows.get(windowId);

  if (!window || window.projectId !== project.id) {
    send(socket, { type: "error", message: "Codex 窗口不存在或不属于当前项目。" });
    socket.close();
    return;
  }

  window.sockets.add(socket);
  send(socket, { type: "snapshot", window: toWindow(window) });

  socket.on("close", () => {
    window.sockets.delete(socket);
  });
}

function startCodex(project: Project, config: ServerConfig, window: CodexWindowRuntime, task: CodexTaskRuntime): void {
  const args = buildCodexArgs(project, task);
  const child = spawn(config.codexCommand, args, {
    cwd: project.path,
    env: process.env,
    shell: true
  });

  task.process = child;
  child.stdin.end(buildPrompt(task));

  child.stdout.on("data", (chunk: Buffer) => {
    appendLog(window, task, "stdout", chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk: Buffer) => {
    appendLog(window, task, "stderr", chunk.toString("utf8"));
  });

  child.on("error", (error) => {
    finishTask(window, task, "failed", undefined, undefined, error.message).catch(() => undefined);
  });

  child.on("exit", (exitCode, signal) => {
    if (task.status === "cancelled") {
      return;
    }

    finishTask(window, task, exitCode === 0 ? "completed" : "failed", exitCode ?? undefined, signal ?? undefined).catch(
      () => undefined
    );
  });
}

function buildCodexArgs(project: Project, task: CodexTaskRuntime): string[] {
  const args = [
    "exec",
    "--cd",
    project.path,
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
    "--output-last-message",
    task.outputFile
  ];
  const attachmentRoot = sharedAttachmentRoot(task.attachments);

  if (attachmentRoot) {
    args.push("--add-dir", attachmentRoot);
  }

  for (const attachment of task.attachments) {
    if (attachment.kind === "image") {
      args.push("--image", attachment.path);
    }
  }

  return args;
}

function buildPrompt(task: CodexTaskRuntime): string {
  if (task.attachments.length === 0) {
    return task.prompt;
  }

  const attachmentLines = task.attachments
    .map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.size)}): ${attachment.path}`)
    .join("\n");

  return `${task.prompt}\n\n附件路径如下，图片已经同时作为图像输入附加：\n${attachmentLines}`;
}

async function finishTask(
  window: CodexWindowRuntime,
  task: CodexTaskRuntime,
  status: CodexTaskStatus,
  exitCode?: number,
  signal?: number | string,
  error?: string
): Promise<void> {
  task.status = status;
  task.exitCode = exitCode;
  task.signal = signal;
  task.error = error;
  task.updatedAt = new Date().toISOString();
  task.finalMessage = await fs.readFile(task.outputFile, "utf8").catch(() => undefined);

  if (!task.finalMessage && status === "failed") {
    task.finalMessage = task.logTail || "Codex 执行失败。";
  }

  touchWindow(window, inferWindowStatus(window));
  broadcast(window, { type: "done", window: toWindow(window), task: toTask(task) });
}

function appendLog(window: CodexWindowRuntime, task: CodexTaskRuntime, stream: "stdout" | "stderr", data: string): void {
  task.updatedAt = new Date().toISOString();
  task.logTail = appendTail(task.logTail, data);
  touchWindow(window, "running");
  broadcast(window, { type: "log", windowId: window.id, taskId: task.id, stream, data });
}

function resolveAttachments(projectId: string, attachmentIds: string[]): CodexAttachment[] {
  const selected: CodexAttachment[] = [];

  for (const id of attachmentIds) {
    const attachment = attachments.get(id);

    if (!attachment || attachment.projectId !== projectId) {
      throw new Error("附件不存在或不属于当前项目。");
    }

    selected.push(attachment);
  }

  return selected;
}

function touchWindow(window: CodexWindowRuntime, status = window.status): void {
  window.status = status;
  window.updatedAt = new Date().toISOString();
}

function inferWindowStatus(window: CodexWindowRuntime): CodexWindow["status"] {
  if (window.tasks.some((task) => task.status === "running")) {
    return "running";
  }

  return window.tasks.at(-1)?.status ?? "idle";
}

function toWindow(window: CodexWindowRuntime): CodexWindow {
  return {
    id: window.id,
    projectId: window.projectId,
    title: window.title,
    status: window.status,
    tasks: window.tasks.map(toTask),
    createdAt: window.createdAt,
    updatedAt: window.updatedAt
  };
}

function toTask(task: CodexTaskRuntime): CodexTask {
  return {
    id: task.id,
    projectId: task.projectId,
    windowId: task.windowId,
    prompt: task.prompt,
    attachments: task.attachments,
    status: task.status,
    finalMessage: task.finalMessage,
    logTail: task.logTail,
    error: task.error,
    exitCode: task.exitCode,
    signal: task.signal,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function broadcast(window: CodexWindowRuntime, message: CodexTaskServerMessage): void {
  for (const socket of window.sockets) {
    send(socket, message);
  }
}

function send(socket: WebSocket, message: CodexTaskServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function appendTail(current: string, data: string): string {
  const next = current + data;
  return next.length > logTailLimit ? next.slice(next.length - logTailLimit) : next;
}

function disposeProcess(child?: ChildProcessWithoutNullStreams): void {
  try {
    child?.kill();
  } catch {
    // The process may already be gone.
  }
}

function sanitizeFileName(input: string): string {
  return path.basename(input.trim()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
}

function sharedAttachmentRoot(selectedAttachments: CodexAttachment[]): string | undefined {
  const first = selectedAttachments[0];
  return first ? path.dirname(path.dirname(first.path)) : undefined;
}

function nextWindowTitle(projectId: string): string {
  const index = [...windows.values()].filter((window) => window.projectId === projectId).length + 1;
  return `Codex ${index}`;
}

function normalizeTitle(value?: string): string | undefined {
  const title = value?.trim();
  return title ? title.slice(0, 48) : undefined;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value}B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.ceil(value / 1024)}KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}
