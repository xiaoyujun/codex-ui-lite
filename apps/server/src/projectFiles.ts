import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project, ProjectFileEntry, ProjectFileList, ProjectMarkdownFile } from "@codex-ui/shared";

const maxMarkdownBytes = 2 * 1024 * 1024;

export async function listProjectFiles(project: Project, relativeDir = ""): Promise<ProjectFileList> {
  const directory = await resolveExistingProjectPath(project.path, relativeDir);
  const stats = await fs.stat(directory.absolutePath);

  if (!stats.isDirectory()) {
    throw new Error("只能浏览项目内的文件夹。");
  }

  const rows = await fs.readdir(directory.absolutePath, { withFileTypes: true });
  const entries: ProjectFileEntry[] = [];

  for (const row of rows) {
    if (row.name === "node_modules" || row.name === ".git") {
      continue;
    }

    const entryRelativePath = joinRelativePath(directory.relativePath, row.name);
    const absoluteEntryPath = path.join(directory.absolutePath, row.name);
    const entryStats = await fs.stat(absoluteEntryPath).catch(() => undefined);

    if (!entryStats) {
      continue;
    }

    if (row.isDirectory()) {
      entries.push({
        name: row.name,
        path: entryRelativePath,
        type: "directory",
        updatedAt: entryStats.mtime.toISOString()
      });
      continue;
    }

    if (row.isFile() && isMarkdownPath(row.name)) {
      entries.push({
        name: row.name,
        path: entryRelativePath,
        type: "markdown",
        size: entryStats.size,
        updatedAt: entryStats.mtime.toISOString()
      });
    }
  }

  entries.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });

  return {
    projectId: project.id,
    path: directory.relativePath,
    parentPath: parentRelativePath(directory.relativePath),
    entries
  };
}

export async function readProjectMarkdown(project: Project, relativeFilePath: string): Promise<ProjectMarkdownFile> {
  const file = await resolveExistingProjectPath(project.path, relativeFilePath);

  if (!isMarkdownPath(file.relativePath)) {
    throw new Error("当前只支持读取 Markdown 文件。");
  }

  const stats = await fs.stat(file.absolutePath);
  if (!stats.isFile()) {
    throw new Error("目标路径不是文件。");
  }

  if (stats.size > maxMarkdownBytes) {
    throw new Error("Markdown 文件超过 2MB，暂不在手机端打开。");
  }

  return {
    projectId: project.id,
    path: file.relativePath,
    name: path.basename(file.absolutePath),
    content: await fs.readFile(file.absolutePath, "utf8"),
    size: stats.size,
    updatedAt: stats.mtime.toISOString()
  };
}

export async function writeProjectMarkdown(project: Project, relativeFilePath: string, content: string): Promise<ProjectMarkdownFile> {
  const file = await resolveExistingProjectPath(project.path, relativeFilePath);

  if (!isMarkdownPath(file.relativePath)) {
    throw new Error("当前只支持保存 Markdown 文件。");
  }

  const stats = await fs.stat(file.absolutePath);
  if (!stats.isFile()) {
    throw new Error("目标路径不是文件。");
  }

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > maxMarkdownBytes) {
    throw new Error("Markdown 内容超过 2MB，已拒绝保存。");
  }

  const tempPath = `${file.absolutePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, file.absolutePath);

  return readProjectMarkdown(project, file.relativePath);
}

function isMarkdownPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

async function resolveExistingProjectPath(projectRoot: string, relativeInput: string): Promise<{ absolutePath: string; relativePath: string }> {
  const root = path.resolve(projectRoot);
  const relativePath = normalizeRelativePath(relativeInput);
  const absolutePath = path.resolve(root, ...relativePath.split("/").filter(Boolean));
  const rootRealPath = await fs.realpath(root);
  const targetRealPath = await fs.realpath(absolutePath);
  const relativeToRoot = path.relative(rootRealPath, targetRealPath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("路径必须位于当前项目目录内。");
  }

  return {
    absolutePath: targetRealPath,
    relativePath: toRelativeUiPath(relativeToRoot)
  };
}

function normalizeRelativePath(input: string): string {
  const normalized = input.trim().replace(/\\/g, "/");

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("只能使用项目内相对路径。");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("路径不能包含 . 或 ..。");
  }

  return parts.join("/");
}

function joinRelativePath(basePath: string, name: string): string {
  return [basePath, name].filter(Boolean).join("/");
}

function parentRelativePath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function toRelativeUiPath(relativePath: string): string {
  return relativePath === "." ? "" : relativePath.replace(/\\/g, "/");
}
