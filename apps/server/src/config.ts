import path from "node:path";

export type ServerConfig = {
  host: string;
  port: number;
  dataDir: string;
  codexCommand: string;
  authDisabled: boolean;
  publicServerUrl?: string;
};

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 4177);
  const dataDir = path.resolve(process.env.DATA_DIR ?? "data");

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.isFinite(port) ? port : 4177,
    dataDir,
    codexCommand: process.env.CODEX_COMMAND ?? "codex",
    authDisabled: process.env.AUTH_DISABLED === "true",
    publicServerUrl: process.env.PUBLIC_SERVER_URL
  };
}
