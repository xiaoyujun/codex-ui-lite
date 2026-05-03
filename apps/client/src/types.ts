import type { Project } from "@codex-ui/shared";

export type Connection = {
  serverUrl: string;
  token: string;
  username?: string;
};

export type View =
  | { name: "login" }
  | { name: "projects" }
  | { name: "workspace"; project: Project };

export type WorkspaceSnapshot = {
  project?: Project;
  activeTerminalId?: string;
};
