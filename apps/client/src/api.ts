import type {
  AuthLoginResponse,
  AuthStatus,
  CodexAttachment,
  CodexWindow,
  CreateProjectRequest,
  CreateCodexTaskRequest,
  CreateCodexWindowRequest,
  Project,
  ProjectFileList,
  ProjectMarkdownFile,
  SaveMarkdownFileRequest,
  TerminalClientMessage,
  TerminalSession,
  UploadCodexAttachmentRequest,
  UpdateProjectRequest
} from "@codex-ui/shared";
import type { Connection } from "./types.js";

export async function getAuthStatus(serverUrl: string): Promise<AuthStatus> {
  return requestWithoutAuth(serverUrl, "/api/auth/status");
}

export async function setupAdmin(serverUrl: string, username: string, password: string): Promise<AuthLoginResponse> {
  return requestWithoutAuth(serverUrl, "/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export async function login(serverUrl: string, username: string, password: string, deviceName: string): Promise<AuthLoginResponse> {
  return requestWithoutAuth(serverUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, deviceName })
  });
}

export async function listProjects(connection: Connection): Promise<Project[]> {
  return request(connection, "/api/projects");
}

export async function createProject(connection: Connection, input: CreateProjectRequest): Promise<Project> {
  return request(connection, "/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateProject(connection: Connection, id: string, input: UpdateProjectRequest): Promise<Project> {
  return request(connection, `/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteProject(connection: Connection, id: string): Promise<void> {
  await request(connection, `/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function logout(connection: Connection): Promise<void> {
  await request(connection, "/api/auth/logout", {
    method: "POST"
  });
}

export async function listProjectFiles(connection: Connection, projectId: string, dir = ""): Promise<ProjectFileList> {
  const params = new URLSearchParams();
  if (dir) {
    params.set("dir", dir);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/files${suffix}`);
}

export async function readProjectMarkdown(
  connection: Connection,
  projectId: string,
  filePath: string
): Promise<ProjectMarkdownFile> {
  const params = new URLSearchParams({ path: filePath });
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/file?${params.toString()}`);
}

export async function saveProjectMarkdown(
  connection: Connection,
  projectId: string,
  input: SaveMarkdownFileRequest
): Promise<ProjectMarkdownFile> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/file`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function listProjectTerminals(connection: Connection, projectId: string): Promise<TerminalSession[]> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/terminals`);
}

export async function createProjectTerminal(
  connection: Connection,
  projectId: string,
  title?: string
): Promise<TerminalSession> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/terminals`, {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export async function closeProjectTerminal(connection: Connection, projectId: string, terminalId: string): Promise<void> {
  await request(connection, `/api/projects/${encodeURIComponent(projectId)}/terminals/${encodeURIComponent(terminalId)}`, {
    method: "DELETE"
  });
}

export async function uploadCodexAttachment(
  connection: Connection,
  projectId: string,
  input: UploadCodexAttachmentRequest
): Promise<CodexAttachment> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/codex/attachments`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listCodexWindows(connection: Connection, projectId: string): Promise<CodexWindow[]> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/codex/windows`);
}

export async function createCodexWindow(
  connection: Connection,
  projectId: string,
  input: CreateCodexWindowRequest = {}
): Promise<CodexWindow> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/codex/windows`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function closeCodexWindow(connection: Connection, projectId: string, windowId: string): Promise<void> {
  await request(connection, `/api/projects/${encodeURIComponent(projectId)}/codex/windows/${encodeURIComponent(windowId)}`, {
    method: "DELETE"
  });
}

export async function createCodexTask(
  connection: Connection,
  projectId: string,
  windowId: string,
  input: CreateCodexTaskRequest
): Promise<CodexWindow> {
  return request(connection, `/api/projects/${encodeURIComponent(projectId)}/codex/windows/${encodeURIComponent(windowId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function cancelCodexTask(
  connection: Connection,
  projectId: string,
  windowId: string,
  taskId: string
): Promise<void> {
  await request(
    connection,
    `/api/projects/${encodeURIComponent(projectId)}/codex/windows/${encodeURIComponent(windowId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE"
    }
  );
}

export function terminalUrl(connection: Connection, projectId: string, terminalId: string): string {
  const base = normalizeUrl(connection.serverUrl);
  const url = new URL("/ws/terminal", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("terminalId", terminalId);
  return url.toString();
}

export function codexWindowUrl(connection: Connection, projectId: string, windowId: string): string {
  const base = normalizeUrl(connection.serverUrl);
  const url = new URL("/ws/codex", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("windowId", windowId);
  return url.toString();
}

export function websocketProtocols(connection: Connection): string[] {
  return ["codex-ui-lite", `auth.${connection.token}`];
}

export function encodeTerminalMessage(message: TerminalClientMessage): string {
  return JSON.stringify(message);
}

async function request<T>(connection: Connection, path: string, init: RequestInit = {}): Promise<T> {
  return requestJson(normalizeUrl(connection.serverUrl), path, {
    ...init,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...jsonHeaders(init)
    }
  });
}

async function requestWithoutAuth<T>(serverUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  return requestJson(normalizeUrl(serverUrl), path, {
    ...init,
    headers: jsonHeaders(init)
  });
}

async function requestJson<T>(serverUrl: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed with ${response.status}.`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function jsonHeaders(init: RequestInit): HeadersInit {
  return {
    "content-type": "application/json",
    ...init.headers
  };
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}
