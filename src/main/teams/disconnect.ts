// 断开 Teams 与 Outlook 网页版：两者共用 persist:dtqd-teams 分区里的微软登录，只能一起退出。
// 先去掉「已连接」标记挡住新同步，再关窗口、等进行中的同步结束，最后才清登录和存档。
import { BrowserWindow, ipcMain } from 'electron';
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  rmdirSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';
import type { MicrosoftWebConnection } from '../../shared/teams';
import { forgetInboxSources } from '../inbox';
import { checkWorkspaceSender } from '../ipc';
import { outlookWebSyncSettled } from '../outlook-web';
import {
  clearOutlookWebConnection,
  outlookWebConnected,
  outlookWebHasRows,
} from '../outlook-web/store';
import { clearTeamsEvents } from './calendar';
import { clearTeamsLogin, removeTeamsSnapshot } from './session';
import { hasTeamsLogin, teamsDirectory, teamsSyncSettled } from './sync';
import { teamsSession } from './window';

/** 根目录下 DTQD 写的固定文件。 */
const GENERATED_ROOT_FILES = new Set([
  '最近更新.md',
  '待办提取.md',
  '.sync-state.json',
  '.sync-state.json.tmp',
]);
/** 会话存档的第一行，见 sync.ts 的 archiveThread。 */
const ARCHIVE_HEADER = /^# \[(频道|会议|群聊|私聊|其他)\] /;
const HEADER_BYTES = 64;

function archiveEntries(root: string): Dirent[] {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
}

function startsWithArchiveHeader(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    try {
      const head = Buffer.alloc(HEADER_BYTES);
      const size = readSync(fd, head, 0, HEADER_BYTES, 0);
      return ARCHIVE_HEADER.test(head.toString('utf8', 0, size));
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function isGeneratedFile(root: string, entry: Dirent): boolean {
  if (!entry.isFile()) return false;
  if (entry.parentPath === root && GENERATED_ROOT_FILES.has(entry.name)) return true;
  return entry.name.endsWith('.md') && startsWithArchiveHeader(join(entry.parentPath, entry.name));
}

export function hasTeamsArchive(root: string): boolean {
  return archiveEntries(root).some(
    (entry) => entry.name.endsWith('.md') && isGeneratedFile(root, entry),
  );
}

export function microsoftWebConnection(): MicrosoftWebConnection {
  return {
    connected: hasTeamsLogin() || outlookWebConnected(),
    hasData: hasTeamsArchive(teamsDirectory()) || outlookWebHasRows(),
  };
}

/** 只删 DTQD 写的文件（会话存档、汇总和同步状态），学生放进去的文件不动，包括他自己的 Markdown。 */
export function deleteTeamsArchive(root: string): void {
  const entries = archiveEntries(root);
  for (const entry of entries) {
    if (isGeneratedFile(root, entry)) rmSync(join(entry.parentPath, entry.name), { force: true });
  }
  // 子目录在前，空目录才能逐层删掉；非空的留着。
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((a, b) => b.length - a.length);
  for (const folder of [...folders, root]) {
    try {
      rmdirSync(folder);
    } catch {
      // 目录里还有学生自己的文件。
    }
  }
}

async function runDisconnect(deleteData: boolean): Promise<MicrosoftWebConnection> {
  clearOutlookWebConnection(false);
  removeTeamsSnapshot();
  const teams = await teamsSession();
  for (const window of BrowserWindow.getAllWindows())
    if (window.webContents.session === teams) window.destroy();
  await Promise.all([teamsSyncSettled(), outlookWebSyncSettled()]);
  await clearTeamsLogin(teams);
  clearOutlookWebConnection(deleteData);
  clearTeamsEvents();
  await forgetInboxSources(['teams', 'outlook']);
  if (deleteData) deleteTeamsArchive(teamsDirectory());
  return microsoftWebConnection();
}

let disconnecting: Promise<MicrosoftWebConnection> | undefined;

export function disconnectMicrosoftWeb(deleteData: boolean): Promise<MicrosoftWebConnection> {
  disconnecting ??= runDisconnect(deleteData).finally(() => {
    disconnecting = undefined;
  });
  return disconnecting;
}

export function registerMicrosoftWebDisconnectIpc(): void {
  ipcMain.handle('teams:connection', (event) => {
    checkWorkspaceSender(event);
    return microsoftWebConnection();
  });
  ipcMain.handle('teams:disconnect', (event, deleteData: unknown) => {
    checkWorkspaceSender(event);
    if (typeof deleteData !== 'boolean') throw new Error('参数无效');
    return disconnectMicrosoftWeb(deleteData);
  });
}
