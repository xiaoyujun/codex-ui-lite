import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { z } from "zod";
import {
  type ApiError,
  type AuthLoginRequest,
  type AuthSetupRequest,
  type CreateCodexWindowRequest,
  type CreateCodexTaskRequest,
  type CreateTerminalSessionRequest,
  type SaveMarkdownFileRequest,
  type UploadCodexAttachmentRequest
} from "@codex-ui/shared";
import { authMiddleware, verifyWsToken } from "./auth.js";
import {
  attachCodexWindow,
  cancelCodexTask,
  createCodexTask,
  createCodexWindow,
  closeCodexWindow,
  listCodexWindows,
  saveCodexAttachment
} from "./codexTasks.js";
import { loadConfig } from "./config.js";
import { asyncRoute, requestServerUrl } from "./http.js";
import { listProjectFiles, readProjectMarkdown, writeProjectMarkdown } from "./projectFiles.js";
import { JsonStore } from "./store.js";
import { attachTerminal, closeTerminalSession, createTerminalSession, listTerminalSessions } from "./terminal.js";

const projectInputSchema = z.object({
  name: z.string().min(1, "项目名称不能为空。"),
  path: z.string().min(1, "项目路径不能为空。"),
  defaultShell: z.string().optional()
});

const projectUpdateSchema = projectInputSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "至少需要修改一项。"
});

const authSetupSchema = z.object({
  username: z.string().min(3, "用户名至少需要 3 个字符。"),
  password: z.string().min(8, "密码至少需要 8 个字符。")
});

const authLoginSchema = authSetupSchema.extend({
  deviceName: z.string().optional()
});

const markdownSaveSchema = z.object({
  path: z.string().min(1, "文件路径不能为空。"),
  content: z.string()
});

const codexAttachmentSchema = z.object({
  name: z.string().min(1, "附件名称不能为空。"),
  mimeType: z.string().optional().default("application/octet-stream"),
  data: z.string().min(1, "附件内容不能为空。")
});

const codexWindowCreateSchema = z.object({
  title: z.string().optional()
});

const codexTaskCreateSchema = z.object({
  prompt: z.string().min(1, "任务内容不能为空。"),
  attachmentIds: z.array(z.string()).optional()
});

const terminalCreateSchema = z.object({
  title: z.string().optional()
});

const config = loadConfig();
const store = new JsonStore(config.dataDir);
await store.init();

const app = express();
app.use(cors());
app.use(express.json({ limit: "18mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get(
  "/api/auth/status",
  asyncRoute(async (_request, response) => {
    response.json({ setupRequired: !(await store.hasAdminAccount()) });
  })
);

app.post(
  "/api/auth/setup",
  asyncRoute(async (request, response) => {
    if (await store.hasAdminAccount()) {
      response.status(409).json({ error: "管理员账号已经存在，请直接登录。" });
      return;
    }

    const body = authSetupSchema.parse(request.body) satisfies AuthSetupRequest;
    await store.createAdminAccount(body.username, body.password);
    const token = await store.login(body.username, body.password, "管理员");

    response.status(201).json({
      token,
      serverUrl: requestServerUrl(request, config),
      username: body.username
    });
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (request, response) => {
    const body = authLoginSchema.parse(request.body) satisfies AuthLoginRequest;
    const token = await store.login(body.username, body.password, body.deviceName);

    if (!token) {
      response.status(401).json({ error: "用户名或密码错误。" });
      return;
    }

    response.json({
      token,
      serverUrl: requestServerUrl(request, config),
      username: body.username
    });
  })
);

app.use("/api", authMiddleware(store, config.authDisabled));

app.post(
  "/api/auth/logout",
  asyncRoute(async (request, response) => {
    if (request.auth?.token) {
      await store.revokeToken(request.auth.token);
    }

    response.status(204).end();
  })
);

app.get(
  "/api/projects",
  asyncRoute(async (_request, response) => {
    response.json(await store.listProjects());
  })
);

app.post(
  "/api/projects",
  asyncRoute(async (request, response) => {
    const body = projectInputSchema.parse(request.body);
    response.status(201).json(await store.createProject(body));
  })
);

app.patch(
  "/api/projects/:id",
  asyncRoute(async (request, response) => {
    const body = projectUpdateSchema.parse(request.body);
    const project = await store.updateProject(paramValue(request.params.id), body);

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    response.json(project);
  })
);

app.delete(
  "/api/projects/:id",
  asyncRoute(async (request, response) => {
    const deleted = await store.deleteProject(paramValue(request.params.id));

    if (!deleted) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    response.status(204).end();
  })
);

app.get(
  "/api/projects/:id/files",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const dir = typeof request.query.dir === "string" ? request.query.dir : "";
    response.json(await listProjectFiles(project, dir));
  })
);

app.get(
  "/api/projects/:id/file",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const filePath = typeof request.query.path === "string" ? request.query.path : "";
    if (!filePath) {
      response.status(400).json({ error: "文件路径不能为空。" });
      return;
    }

    response.json(await readProjectMarkdown(project, filePath));
  })
);

app.put(
  "/api/projects/:id/file",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const body = markdownSaveSchema.parse(request.body) satisfies SaveMarkdownFileRequest;
    response.json(await writeProjectMarkdown(project, body.path, body.content));
  })
);

app.post(
  "/api/projects/:id/codex/attachments",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const body = codexAttachmentSchema.parse(request.body) satisfies UploadCodexAttachmentRequest;
    response.status(201).json(await saveCodexAttachment(project, config, body));
  })
);

app.get(
  "/api/projects/:id/codex/windows",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    response.json(listCodexWindows(project.id));
  })
);

app.post(
  "/api/projects/:id/codex/windows",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const body = codexWindowCreateSchema.parse(request.body ?? {}) satisfies CreateCodexWindowRequest;
    await store.touchProject(project.id);
    response.status(201).json(createCodexWindow(project, body));
  })
);

app.post(
  "/api/projects/:id/codex/windows/:windowId/tasks",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const body = codexTaskCreateSchema.parse(request.body) satisfies CreateCodexTaskRequest;
    await store.touchProject(project.id);
    response.status(201).json(await createCodexTask(project, config, paramValue(request.params.windowId), body));
  })
);

app.delete(
  "/api/projects/:id/codex/windows/:windowId/tasks/:taskId",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const cancelled = cancelCodexTask(project.id, paramValue(request.params.windowId), paramValue(request.params.taskId));

    if (!cancelled) {
      response.status(404).json({ error: "Codex 任务不存在。" });
      return;
    }

    response.status(204).end();
  })
);

app.delete(
  "/api/projects/:id/codex/windows/:windowId",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const closed = closeCodexWindow(project.id, paramValue(request.params.windowId));

    if (!closed) {
      response.status(404).json({ error: "Codex 窗口不存在。" });
      return;
    }

    response.status(204).end();
  })
);

app.get(
  "/api/projects/:id/terminals",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    response.json(listTerminalSessions(project.id));
  })
);

app.post(
  "/api/projects/:id/terminals",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const body = terminalCreateSchema.parse(request.body ?? {}) satisfies CreateTerminalSessionRequest;
    await store.touchProject(project.id);
    response.status(201).json(await createTerminalSession(project, config, body.title));
  })
);

app.delete(
  "/api/projects/:id/terminals/:terminalId",
  asyncRoute(async (request, response) => {
    const project = await store.getProject(paramValue(request.params.id));

    if (!project) {
      response.status(404).json({ error: "项目不存在。" });
      return;
    }

    const closed = closeTerminalSession(project.id, paramValue(request.params.terminalId));

    if (!closed) {
      response.status(404).json({ error: "终端会话不存在。" });
      return;
    }

    response.status(204).end();
  })
);

app.use((error: unknown, _request: express.Request, response: express.Response<ApiError>, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "请求格式不正确。" });
    return;
  }

  response.status(500).json({ error: error instanceof Error ? error.message : "服务器内部错误。" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== "/ws/terminal" && url.pathname !== "/ws/codex") {
    socket.destroy();
    return;
  }

  const token = url.searchParams.get("token");
  const projectId = url.searchParams.get("projectId");
  const terminalId = url.searchParams.get("terminalId") ?? undefined;
  const windowId = url.searchParams.get("windowId") ?? undefined;

  if (!(await verifyWsToken(store, token, config.authDisabled)) || !projectId) {
    socket.destroy();
    return;
  }

  const project = await store.getProject(projectId);

  if (!project) {
    socket.destroy();
    return;
  }

  await store.touchProject(projectId);
  wss.handleUpgrade(request, socket, head, (websocket) => {
    if (url.pathname === "/ws/codex") {
      if (!windowId) {
        websocket.close();
        return;
      }

      attachCodexWindow(websocket, project, windowId);
      return;
    }

    attachTerminal(websocket, project, config, terminalId).catch((error: unknown) => {
      websocket.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "无法启动终端。"
        })
      );
      websocket.close();
    });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Codex 项目终端服务已启动: http://${config.host}:${config.port}`);
});

function paramValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
