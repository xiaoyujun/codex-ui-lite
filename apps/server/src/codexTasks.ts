import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodexAttachment,
  CodexTask,
  CodexTaskServerMessage,
  CreateCodexTaskRequest,
  Project,
  UploadCodexAttachmentRequest
} from "@codex-ui/shared";
import type { WebSocket } from "ws";
import type { ServerConfig } from "./config.js";

type CodexTaskRuntime = CodexTask & {
  process?: ChildProcessWithoutNullStreams;
  outputFile: string;
  sockets: Set<WebSocket>;
};

const attachments = new Map<string, CodexAttachment>();
const tasks = new Map<string, CodexTaskRuntime>();
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

export function listCodexTasks(projectId: string): CodexTask[] {
  return [...tasks.values()]
    .filter((task) => task.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toTask);
}

export function getCodexTask(projectId: string, taskId: string): CodexTask | undefined {
  const task = tasks.get(taskId);
  return task?.projectId === projectId ? toTask(task) : undefined;
}

export async function createCodexTask(
  project: Project,
  config: ServerConfig,
  input: CreateCodexTaskRequest
): Promise<CodexTask> {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("请输入要交给 Codex 的任务。");
  }

  const selectedAttachments = resolveAttachments(project.id, input.attachmentIds ?? []);
  const id = `c_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const now = new Date().toISOString();
  const outputDirectory = path.join(config.dataDir, "codex-task-output");
  const outputFile = path.join(outputDirectory, `${id}.md`);
  const task: CodexTaskRuntime = {
    id,
    projectId: project.id,
    prompt,
    attachments: selectedAttachments,
    status: "running",
    logTail: "",
    outputFile,
    sockets: new Set(),
    createdAt: now,
    updatedAt: now
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  tasks.set(id, task);
  startCodex(project, config, task);

  return toTask(task);
}

export function cancelCodexTask(projectId: string, taskId: string): boolean {
  const task = tasks.get(taskId);

  if (!task || task.projectId !== projectId) {
    return false;
  }

  if (task.status === "running") {
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    disposeProcess(task.process);
    broadcast(task, { type: "done", task: toTask(task) });
  }

  return true;
}

export function attachCodexTask(socket: WebSocket, project: Project, taskId: string): void {
  const task = tasks.get(taskId);

  if (!task || task.projectId !== project.id) {
    send(socket, { type: "error", message: "Codex 任务不存在或不属于当前项目。" });
    socket.close();
    return;
  }

  task.sockets.add(socket);
  send(socket, { type: "snapshot", task: toTask(task) });

  socket.on("close", () => {
    task.sockets.delete(socket);
  });
}

function startCodex(project: Project, config: ServerConfig, task: CodexTaskRuntime): void {
  const args = buildCodexArgs(project, task);
  const child = spawn(config.codexCommand, args, {
    cwd: project.path,
    env: process.env,
    shell: true
  });

  task.process = child;
  child.stdin.end(buildPrompt(task));

  child.stdout.on("data", (chunk: Buffer) => {
    appendLog(task, "stdout", chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk: Buffer) => {
    appendLog(task, "stderr", chunk.toString("utf8"));
  });

  child.on("error", (error) => {
    finishTask(task, "failed", undefined, undefined, error.message).catch(() => undefined);
  });

  child.on("exit", (exitCode, signal) => {
    if (task.status === "cancelled") {
      return;
    }

    finishTask(task, exitCode === 0 ? "completed" : "failed", exitCode ?? undefined, signal ?? undefined).catch(() => undefined);
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
  task: CodexTaskRuntime,
  status: CodexTask["status"],
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

  broadcast(task, { type: "done", task: toTask(task) });
}

function appendLog(task: CodexTaskRuntime, stream: "stdout" | "stderr", data: string): void {
  task.updatedAt = new Date().toISOString();
  task.logTail = appendTail(task.logTail, data);
  broadcast(task, { type: "log", taskId: task.id, stream, data });
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

function toTask(task: CodexTaskRuntime): CodexTask {
  return {
    id: task.id,
    projectId: task.projectId,
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

function broadcast(task: CodexTaskRuntime, message: CodexTaskServerMessage): void {
  for (const socket of task.sockets) {
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value}B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.ceil(value / 1024)}KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}
