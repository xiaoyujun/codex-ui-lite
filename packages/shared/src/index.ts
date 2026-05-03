export type Project = {
  id: string;
  name: string;
  path: string;
  defaultShell?: string;
  createdAt: string;
  lastOpenedAt?: string;
};

export type CreateProjectRequest = {
  name: string;
  path: string;
  defaultShell?: string;
};

export type UpdateProjectRequest = Partial<CreateProjectRequest>;

export type ProjectFileEntry = {
  name: string;
  path: string;
  type: "directory" | "markdown";
  size?: number;
  updatedAt?: string;
};

export type ProjectFileList = {
  projectId: string;
  path: string;
  parentPath: string;
  entries: ProjectFileEntry[];
};

export type ProjectMarkdownFile = {
  projectId: string;
  path: string;
  name: string;
  content: string;
  size: number;
  updatedAt?: string;
};

export type SaveMarkdownFileRequest = {
  path: string;
  content: string;
};

export type TerminalSessionStatus = "running" | "exited";

export type TerminalSession = {
  id: string;
  projectId: string;
  title: string;
  shell: string;
  status: TerminalSessionStatus;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  signal?: number | string;
};

export type CreateTerminalSessionRequest = {
  title?: string;
};

export type CodexAttachmentKind = "image" | "file";

export type CodexAttachment = {
  id: string;
  projectId: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  kind: CodexAttachmentKind;
  createdAt: string;
};

export type UploadCodexAttachmentRequest = {
  name: string;
  mimeType: string;
  data: string;
};

export type CodexTaskStatus = "running" | "completed" | "failed" | "cancelled";

export type CodexTask = {
  id: string;
  projectId: string;
  prompt: string;
  attachments: CodexAttachment[];
  status: CodexTaskStatus;
  finalMessage?: string;
  logTail: string;
  error?: string;
  exitCode?: number;
  signal?: number | string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCodexTaskRequest = {
  prompt: string;
  attachmentIds?: string[];
};

export type CodexTaskServerMessage =
  | { type: "snapshot"; task: CodexTask }
  | { type: "log"; taskId: string; stream: "stdout" | "stderr"; data: string }
  | { type: "done"; task: CodexTask }
  | { type: "error"; message: string };

export type AuthStatus = {
  setupRequired: boolean;
};

export type AuthSetupRequest = {
  username: string;
  password: string;
};

export type AuthLoginRequest = {
  username: string;
  password: string;
  deviceName?: string;
};

export type AuthLoginResponse = {
  token: string;
  serverUrl: string;
  username: string;
};

export type ApiError = {
  error: string;
};

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "launchCodex" }
  | { type: "signal"; signal: "SIGINT" | "SIGTERM" };

export type TerminalServerMessage =
  | { type: "ready"; projectId: string; terminalId: string; shell: string; title: string }
  | { type: "output"; data: string }
  | { type: "exit"; code?: number; signal?: number | string }
  | { type: "error"; message: string };
