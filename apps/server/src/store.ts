import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { CreateProjectRequest, Project, UpdateProjectRequest } from "@codex-ui/shared";
import { nanoid } from "nanoid";

type DeviceToken = {
  id: string;
  accountUsername?: string;
  deviceName?: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string;
};

type UserAccount = {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt?: string;
};

type ProjectMetadata = {
  defaultShell?: string;
  createdAt?: string;
  lastOpenedAt?: string;
};

type StoredData = {
  accounts: UserAccount[];
  devices: DeviceToken[];
  projectMetadata: Record<string, ProjectMetadata>;
};

const emptyData = (): StoredData => ({
  accounts: [],
  devices: [],
  projectMetadata: {}
});

export class JsonStore {
  private readonly filePath: string;
  private readonly codexGlobalStatePath: string;
  private dataMutationQueue: Promise<void> = Promise.resolve();
  private codexStateMutationQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "codex-ui-lite.json");
    this.codexGlobalStatePath = path.join(getCodexHomeDir(), ".codex-global-state.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(emptyData());
    }
  }

  async listProjects(): Promise<Project[]> {
    const data = await this.read();
    const workspace = await this.readWorkspaceState();
    const orderedPaths = uniquePaths([...workspace.projectOrder, ...workspace.order, ...workspace.active]);
    const existingPaths = await filterExistingDirectories(orderedPaths);

    return existingPaths.map((projectPath) => this.toProject(projectPath, workspace.labels[projectPath], data.projectMetadata[projectPath]));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const projects = await this.listProjects();
    return projects.find((project) => project.id === id);
  }

  async createProject(input: CreateProjectRequest): Promise<Project> {
    const projectPath = await resolveProjectPath(input.path);
    const now = new Date().toISOString();
    const name = normalizeProjectName(input.name);
    let metadata: ProjectMetadata = {};

    await this.mutateData((data) => {
      metadata = {
        ...data.projectMetadata[projectPath],
        defaultShell: normalizeOptional(input.defaultShell),
        createdAt: data.projectMetadata[projectPath]?.createdAt ?? now,
        lastOpenedAt: now
      };
      data.projectMetadata[projectPath] = metadata;
    });
    await this.upsertWorkspaceRoot(projectPath, { label: name, activate: true });

    return this.toProject(projectPath, name, metadata);
  }

  async updateProject(id: string, input: UpdateProjectRequest): Promise<Project | undefined> {
    const existing = await this.getProject(id);
    if (!existing) {
      return undefined;
    }

    const nextPath = input.path === undefined ? existing.path : await resolveProjectPath(input.path);
    const nextName = input.name === undefined ? existing.name : normalizeProjectName(input.name);
    let nextMeta: ProjectMetadata = {};

    await this.mutateData((data) => {
      const currentMeta = data.projectMetadata[existing.path] ?? {};
      nextMeta = {
        ...currentMeta,
        defaultShell:
          input.defaultShell === undefined ? currentMeta.defaultShell : normalizeOptional(input.defaultShell),
        createdAt: currentMeta.createdAt ?? existing.createdAt,
        lastOpenedAt: new Date().toISOString()
      };

      if (nextPath !== existing.path) {
        delete data.projectMetadata[existing.path];
      }

      data.projectMetadata[nextPath] = nextMeta;
    });
    await this.upsertWorkspaceRoot(nextPath, { label: nextName, activate: true, previousPath: existing.path });

    return this.toProject(nextPath, nextName, nextMeta);
  }

  async deleteProject(id: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) {
      return false;
    }

    await this.mutateData((data) => {
      delete data.projectMetadata[project.path];
    });
    await this.removeWorkspaceRoot(project.path);
    return true;
  }

  async touchProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      return;
    }

    await this.mutateData((data) => {
      data.projectMetadata[project.path] = {
        ...data.projectMetadata[project.path],
        lastOpenedAt: new Date().toISOString()
      };
    });
    await this.upsertWorkspaceRoot(project.path, { activate: true });
  }

  async hasAdminAccount(): Promise<boolean> {
    const data = await this.read();
    return data.accounts.length > 0;
  }

  async createAdminAccount(username: string, password: string): Promise<void> {
    await this.mutateData((data) => {
      if (data.accounts.length > 0) {
        throw new Error("管理员账号已经存在。");
      }

      const now = new Date().toISOString();
      data.accounts.push({
        username: normalizeUsername(username),
        ...hashPassword(password),
        createdAt: now
      });
    });
  }

  async login(username: string, password: string, deviceName?: string): Promise<string | undefined> {
    const data = await this.read();
    const normalizedUsername = normalizeUsername(username);
    const account = data.accounts.find((item) => item.username.toLowerCase() === normalizedUsername.toLowerCase());

    if (!account || !verifyPassword(password, account)) {
      return undefined;
    }

    return this.createDeviceToken(deviceName || normalizedUsername, account.username);
  }

  async revokeToken(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await this.mutateData((data) => {
      data.devices = data.devices.filter((item) => item.tokenHash !== tokenHash);
    });
  }

  async createDeviceToken(deviceName?: string, accountUsername?: string): Promise<string> {
    const token = `cul_${randomBytes(32).toString("base64url")}`;
    await this.mutateData((data) => {
      data.devices.push({
        id: nanoid(12),
        accountUsername,
        deviceName: normalizeOptional(deviceName),
        tokenHash: hashToken(token),
        createdAt: new Date().toISOString()
      });
    });
    return token;
  }

  async verifyToken(token: string): Promise<boolean> {
    const data = await this.read();
    const tokenHash = hashToken(token);
    const device = data.devices.find((item) => item.tokenHash === tokenHash);
    const accountUsername = device?.accountUsername;

    if (!device || !accountUsername || !data.accounts.some((account) => account.username === accountUsername)) {
      return false;
    }

    return true;
  }

  private async read(): Promise<StoredData> {
    try {
      const contents = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as Partial<StoredData> & { projects?: Project[] };
      const projectMetadata = isRecord(parsed.projectMetadata) ? normalizeProjectMetadata(parsed.projectMetadata) : {};

      for (const project of Array.isArray(parsed.projects) ? parsed.projects : []) {
        if (!project?.path || projectMetadata[project.path]) {
          continue;
        }

        projectMetadata[project.path] = {
          defaultShell: project.defaultShell,
          createdAt: project.createdAt,
          lastOpenedAt: project.lastOpenedAt
        };
      }

      return {
        accounts: normalizeAccounts(parsed.accounts),
        devices: normalizeDevices(parsed.devices),
        projectMetadata
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyData();
      }

      throw error;
    }
  }

  private async write(data: StoredData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  private async mutateData<T>(mutator: (data: StoredData) => Promise<T> | T): Promise<T> {
    const operation = this.dataMutationQueue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.write(data);
      return result;
    });

    this.dataMutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async readWorkspaceState(): Promise<WorkspaceState> {
    const payload = await this.readCodexGlobalState();
    return {
      order: normalizeStringArray(payload["electron-saved-workspace-roots"]),
      active: normalizeStringArray(payload["active-workspace-roots"]),
      projectOrder: normalizeStringArray(payload["project-order"]),
      labels: normalizeStringRecord(payload["electron-workspace-root-labels"])
    };
  }

  private async upsertWorkspaceRoot(
    projectPath: string,
    options: { label?: string; activate?: boolean; previousPath?: string } = {}
  ): Promise<void> {
    await this.mutateCodexGlobalState((payload) => {
      const workspace = {
        order: normalizeStringArray(payload["electron-saved-workspace-roots"]),
        active: normalizeStringArray(payload["active-workspace-roots"]),
        projectOrder: normalizeStringArray(payload["project-order"]),
        labels: normalizeStringRecord(payload["electron-workspace-root-labels"])
      };

      const previousPath = options.previousPath && options.previousPath !== projectPath ? options.previousPath : undefined;
      const withoutPrevious = (items: string[]) => items.filter((item) => item !== projectPath && item !== previousPath);

      payload["electron-saved-workspace-roots"] = [projectPath, ...withoutPrevious(workspace.order)];
      payload["project-order"] = [projectPath, ...withoutPrevious(workspace.projectOrder)];
      payload["active-workspace-roots"] = options.activate
        ? [projectPath, ...withoutPrevious(workspace.active)]
        : withoutPrevious(workspace.active);

      if (previousPath) {
        delete workspace.labels[previousPath];
      }
      if (options.label?.trim()) {
        workspace.labels[projectPath] = options.label.trim();
      }
      payload["electron-workspace-root-labels"] = workspace.labels;
    });
  }

  private async removeWorkspaceRoot(projectPath: string): Promise<void> {
    await this.mutateCodexGlobalState((payload) => {
      const labels = normalizeStringRecord(payload["electron-workspace-root-labels"]);
      delete labels[projectPath];

      payload["electron-saved-workspace-roots"] = normalizeStringArray(payload["electron-saved-workspace-roots"]).filter(
        (item) => item !== projectPath
      );
      payload["active-workspace-roots"] = normalizeStringArray(payload["active-workspace-roots"]).filter(
        (item) => item !== projectPath
      );
      payload["project-order"] = normalizeStringArray(payload["project-order"]).filter((item) => item !== projectPath);
      payload["electron-workspace-root-labels"] = labels;
    });
  }

  private async readCodexGlobalState(): Promise<Record<string, unknown>> {
    try {
      const contents = await fs.readFile(this.codexGlobalStatePath, "utf8");
      const parsed = JSON.parse(contents) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeCodexGlobalState(payload: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(this.codexGlobalStatePath), { recursive: true });
    const tempPath = `${this.codexGlobalStatePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload), "utf8");
    await fs.rename(tempPath, this.codexGlobalStatePath);
  }

  private async mutateCodexGlobalState<T>(mutator: (payload: Record<string, unknown>) => Promise<T> | T): Promise<T> {
    const operation = this.codexStateMutationQueue.then(async () => {
      const payload = await this.readCodexGlobalState();
      const result = await mutator(payload);
      await this.writeCodexGlobalState(payload);
      return result;
    });

    this.codexStateMutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private toProject(projectPath: string, label: string | undefined, metadata: ProjectMetadata | undefined): Project {
    const now = new Date().toISOString();
    return {
      id: projectId(projectPath),
      name: label?.trim() || path.basename(projectPath.replace(/[\\/]+$/, "")) || projectPath,
      path: projectPath,
      defaultShell: metadata?.defaultShell,
      createdAt: metadata?.createdAt ?? now,
      lastOpenedAt: metadata?.lastOpenedAt
    };
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string): Pick<UserAccount, "passwordHash" | "passwordSalt"> {
  const normalized = normalizePassword(password);
  const passwordSalt = randomBytes(16).toString("base64url");
  const passwordHash = scryptSync(normalized, passwordSalt, 64).toString("base64");
  return { passwordHash, passwordSalt };
}

function verifyPassword(password: string, account: UserAccount): boolean {
  const candidate = scryptSync(password, account.passwordSalt, 64);
  const expected = Buffer.from(account.passwordHash, "base64");

  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(candidate, expected);
}

function normalizeUsername(username: string): string {
  const normalized = username.trim();

  if (normalized.length < 3) {
    throw new Error("用户名至少需要 3 个字符。");
  }

  return normalized;
}

function normalizePassword(password: string): string {
  if (password.length < 8) {
    throw new Error("密码至少需要 8 个字符。");
  }

  return password;
}

function projectId(projectPath: string): string {
  return `p_${createHash("sha256").update(projectPath.toLowerCase()).digest("base64url").slice(0, 22)}`;
}

function normalizeProjectName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("项目名称不能为空。");
  }

  return normalized;
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function resolveProjectPath(inputPath: string): Promise<string> {
  const normalized = inputPath.trim();

  if (!normalized) {
    throw new Error("项目路径不能为空。");
  }

  const resolved = path.resolve(normalized);
  const stats = await fs.stat(resolved);

  if (!stats.isDirectory()) {
    throw new Error("项目路径必须是本机已存在的文件夹。");
  }

  return resolved;
}

type WorkspaceState = {
  order: string[];
  active: string[];
  projectOrder: string[];
  labels: Record<string, string>;
};

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return codexHome ? codexHome : path.join(homedir(), ".codex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniquePaths(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])));
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const next: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string" && key.trim() && rawValue.trim()) {
      next[key] = rawValue.trim();
    }
  }
  return next;
}

function normalizeProjectMetadata(value: Record<string, unknown>): Record<string, ProjectMetadata> {
  const next: Record<string, ProjectMetadata> = {};
  for (const [projectPath, rawValue] of Object.entries(value)) {
    if (!isRecord(rawValue)) {
      continue;
    }

    next[projectPath] = {
      defaultShell: typeof rawValue.defaultShell === "string" ? rawValue.defaultShell : undefined,
      createdAt: typeof rawValue.createdAt === "string" ? rawValue.createdAt : undefined,
      lastOpenedAt: typeof rawValue.lastOpenedAt === "string" ? rawValue.lastOpenedAt : undefined
    };
  }
  return next;
}

function normalizeAccounts(value: unknown): UserAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const username = typeof item.username === "string" ? item.username.trim() : "";
    const passwordHash = typeof item.passwordHash === "string" ? item.passwordHash : "";
    const passwordSalt = typeof item.passwordSalt === "string" ? item.passwordSalt : "";
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();

    return username && passwordHash && passwordSalt
      ? [
          {
            username,
            passwordHash,
            passwordSalt,
            createdAt,
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined
          }
        ]
      : [];
  });
}

function normalizeDevices(value: unknown): DeviceToken[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = typeof item.id === "string" ? item.id : nanoid(12);
    const tokenHash = typeof item.tokenHash === "string" ? item.tokenHash : "";
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();

    if (!tokenHash) {
      return [];
    }

    return [
      {
        id,
        accountUsername: typeof item.accountUsername === "string" ? item.accountUsername : undefined,
        deviceName: typeof item.deviceName === "string" ? item.deviceName : undefined,
        tokenHash,
        createdAt,
        lastUsedAt: typeof item.lastUsedAt === "string" ? item.lastUsedAt : undefined
      }
    ];
  });
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const item of paths) {
    const normalized = item.trim();
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
  }

  return next;
}

async function filterExistingDirectories(paths: string[]): Promise<string[]> {
  const next: string[] = [];
  for (const projectPath of paths) {
    try {
      const stats = await fs.stat(projectPath);
      if (stats.isDirectory()) {
        next.push(projectPath);
      }
    } catch {
      // Ignore stale Codex desktop workspace roots that no longer exist locally.
    }
  }
  return next;
}
