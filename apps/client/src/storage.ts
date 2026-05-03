import { Preferences } from "@capacitor/preferences";
import type { Connection, WorkspaceSnapshot } from "./types.js";

const connectionKey = "codex-ui-lite.account-connection.v1";
const legacyConnectionKey = "codex-ui-lite.connection";
const workspaceKey = "codex-ui-lite.workspace.v1";

export async function loadConnection(): Promise<Connection | undefined> {
  const stored = await Preferences.get({ key: connectionKey });
  const legacyRaw = localStorage.getItem(connectionKey);
  const raw = stored.value ?? legacyRaw;

  if (!raw) {
    localStorage.removeItem(legacyConnectionKey);
    localStorage.removeItem(connectionKey);
    await Preferences.remove({ key: legacyConnectionKey });
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Connection>;
    if (parsed.serverUrl && parsed.token) {
      const connection = {
        serverUrl: parsed.serverUrl,
        token: parsed.token,
        username: typeof parsed.username === "string" ? parsed.username : undefined
      };
      if (!stored.value && legacyRaw) {
        await Preferences.set({ key: connectionKey, value: legacyRaw });
      }
      localStorage.removeItem(connectionKey);
      return connection;
    }
  } catch {
    localStorage.removeItem(connectionKey);
    return undefined;
  }

  localStorage.removeItem(connectionKey);
  return undefined;
}

export async function saveConnection(connection: Connection): Promise<void> {
  const value = JSON.stringify(connection);
  localStorage.removeItem(connectionKey);
  await Preferences.set({ key: connectionKey, value });
}

export async function clearConnection(): Promise<void> {
  localStorage.removeItem(connectionKey);
  localStorage.removeItem(legacyConnectionKey);
  await Preferences.remove({ key: connectionKey });
  await Preferences.remove({ key: legacyConnectionKey });
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  const stored = await Preferences.get({ key: workspaceKey });
  const legacyRaw = localStorage.getItem(workspaceKey);
  const raw = stored.value ?? legacyRaw;

  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    if (parsed.project?.id) {
      if (!stored.value && legacyRaw) {
        await Preferences.set({ key: workspaceKey, value: legacyRaw });
      }
      localStorage.removeItem(workspaceKey);
      return parsed;
    }
  } catch {
    localStorage.removeItem(workspaceKey);
    return undefined;
  }

  localStorage.removeItem(workspaceKey);
  return undefined;
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const value = JSON.stringify(snapshot);
  localStorage.removeItem(workspaceKey);
  await Preferences.set({ key: workspaceKey, value });
}

export async function clearWorkspaceSnapshot(): Promise<void> {
  localStorage.removeItem(workspaceKey);
  await Preferences.remove({ key: workspaceKey });
}
