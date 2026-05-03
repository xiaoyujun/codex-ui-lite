import { randomUUID } from "node:crypto";
import os from "node:os";
import type {
  Project,
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSession
} from "@codex-ui/shared";
import type { WebSocket } from "ws";
import type { ServerConfig } from "./config.js";

type PtyProcess = import("node-pty").IPty;

type TerminalRuntime = TerminalSession & {
  projectPath: string;
  term: PtyProcess;
  sockets: Set<WebSocket>;
  buffer: string;
  cols: number;
  rows: number;
};

const sessions = new Map<string, TerminalRuntime>();
const outputBufferLimit = 400_000;

export function listTerminalSessions(projectId: string): TerminalSession[] {
  return [...sessions.values()]
    .filter((session) => session.projectId === projectId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(toSession);
}

export async function createTerminalSession(
  project: Project,
  config: ServerConfig,
  title?: string
): Promise<TerminalSession> {
  const pty = await import("node-pty");
  const shell = project.defaultShell ?? defaultShell();
  const now = new Date().toISOString();
  const session: TerminalRuntime = {
    id: `t_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
    projectId: project.id,
    projectPath: project.path,
    title: normalizeTitle(title) ?? nextSessionTitle(project.id),
    shell,
    status: "running",
    createdAt: now,
    updatedAt: now,
    term: pty.spawn(shell, [], {
      name: "xterm-256color",
      cwd: project.path,
      cols: 100,
      rows: 30,
      env: process.env
    }),
    sockets: new Set(),
    buffer: "",
    cols: 100,
    rows: 30
  };

  sessions.set(session.id, session);

  session.term.onData((data) => {
    session.updatedAt = new Date().toISOString();
    session.buffer = appendBuffer(session.buffer, data);
    broadcast(session, { type: "output", data });
  });

  session.term.onExit(({ exitCode, signal }) => {
    session.status = "exited";
    session.exitCode = exitCode;
    session.signal = signal;
    session.updatedAt = new Date().toISOString();
    broadcast(session, { type: "exit", code: exitCode, signal });
    closeAttachedSockets(session);
  });

  return toSession(session);
}

export function closeTerminalSession(projectId: string, terminalId: string): boolean {
  const session = sessions.get(terminalId);

  if (!session || session.projectId !== projectId) {
    return false;
  }

  sessions.delete(terminalId);
  if (session.status === "running") {
    broadcast(session, { type: "exit", signal: "SIGTERM" });
    disposeTerminal(session.term);
  }
  closeAttachedSockets(session);
  return true;
}

export async function attachTerminal(
  socket: WebSocket,
  project: Project,
  config: ServerConfig,
  terminalId?: string
): Promise<void> {
  const session = terminalId ? sessions.get(terminalId) : await createRuntimeSession(project, config);

  if (!session || session.projectId !== project.id) {
    send(socket, { type: "error", message: "终端会话不存在或不属于当前项目。" });
    socket.close();
    return;
  }

  session.sockets.add(socket);
  session.updatedAt = new Date().toISOString();

  send(socket, {
    type: "ready",
    projectId: project.id,
    terminalId: session.id,
    shell: session.shell,
    title: session.title
  });

  if (session.buffer) {
    send(socket, { type: "output", data: session.buffer });
  }

  if (session.status === "exited") {
    send(socket, { type: "exit", code: session.exitCode, signal: session.signal });
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    handleMessage(raw.toString(), session, config);
  });

  socket.on("close", () => {
    session.sockets.delete(socket);
  });
}

async function createRuntimeSession(project: Project, config: ServerConfig): Promise<TerminalRuntime> {
  const session = await createTerminalSession(project, config);
  const runtime = sessions.get(session.id);

  if (!runtime) {
    throw new Error("无法创建终端会话。");
  }

  return runtime;
}

function handleMessage(raw: string, session: TerminalRuntime, config: ServerConfig): void {
  let message: TerminalClientMessage;

  try {
    message = JSON.parse(raw) as TerminalClientMessage;
  } catch {
    return;
  }

  if (session.status !== "running") {
    return;
  }

  if (message.type === "input") {
    session.term.write(message.data);
  } else if (message.type === "resize") {
    session.cols = clamp(message.cols, 20, 240);
    session.rows = clamp(message.rows, 6, 80);
    session.term.resize(session.cols, session.rows);
  } else if (message.type === "launchCodex") {
    session.term.write(`${config.codexCommand}\r`);
  } else if (message.type === "signal") {
    if (message.signal === "SIGINT") {
      session.term.write("\u0003");
    } else {
      closeTerminalSession(session.projectId, session.id);
    }
  }
}

function toSession(session: TerminalRuntime): TerminalSession {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    shell: session.shell,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exitCode: session.exitCode,
    signal: session.signal
  };
}

function broadcast(session: TerminalRuntime, message: TerminalServerMessage): void {
  for (const socket of session.sockets) {
    send(socket, message);
  }
}

function send(socket: WebSocket, message: TerminalServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function closeAttachedSockets(session: TerminalRuntime): void {
  for (const socket of session.sockets) {
    socket.close();
  }
  session.sockets.clear();
}

function defaultShell(): string {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "powershell.exe";
  }

  return os.userInfo().shell || "/bin/sh";
}

function disposeTerminal(term: PtyProcess): void {
  try {
    term.kill();
  } catch {
    // The PTY may already be gone after a normal exit.
  }
}

function appendBuffer(current: string, data: string): string {
  const next = current + data;
  return next.length > outputBufferLimit ? next.slice(next.length - outputBufferLimit) : next;
}

function nextSessionTitle(projectId: string): string {
  const index = [...sessions.values()].filter((session) => session.projectId === projectId).length + 1;
  return `终端 ${index}`;
}

function normalizeTitle(value?: string): string | undefined {
  const title = value?.trim();
  return title ? title.slice(0, 48) : undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}
