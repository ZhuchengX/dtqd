// QQ / 微信「接收文件」目录扫描：只读列出本机已收到的文件，不读聊天记录、不解密任何数据库。
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ChatApp = 'qq' | 'wechat';

export interface ChatFileRoot {
  app: ChatApp;
  path: string;
}

export interface ChatFile {
  app: ChatApp;
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

const SKIP_DIRECTORIES = new Set(['Thumb', 'ThumbTemp', 'thumb', 'temp', 'Temp', 'cache', 'Cache']);
const MAX_DEPTH = 4;

async function children(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

/** 本机默认接收目录（QQ NT、微信 4.x 与旧版微信）；路径不存在的候选直接跳过。 */
export async function defaultChatFileRoots(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): Promise<ChatFileRoot[]> {
  const roots: ChatFileRoot[] = [];
  const add = (app: ChatApp, path: string) => {
    if (existsSync(path)) roots.push({ app, path });
  };
  if (platform === 'darwin') {
    add('qq', join(home, 'Library/Containers/com.tencent.qq/Data/Downloads'));
    const wechat = join(
      home,
      'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files',
    );
    for (const account of await children(wechat)) add('wechat', join(account, 'msg/file'));
  } else if (platform === 'win32') {
    const documents = join(home, 'Documents');
    for (const account of await children(join(documents, 'Tencent Files')))
      add('qq', join(account, 'nt_qq/nt_data/File'));
    add('qq', join(documents, 'Tencent Files', 'FileRecv'));
    for (const account of await children(join(documents, 'xwechat_files')))
      add('wechat', join(account, 'msg/file'));
    for (const account of await children(join(documents, 'WeChat Files')))
      add('wechat', join(account, 'FileStorage/File'));
  }
  return roots;
}

/** 递归列出接收目录中的文件，按修改时间倒序；跳过缩略图与临时目录、隐藏文件。 */
export async function listChatFiles(
  roots: ChatFileRoot[],
  options: { sinceMs?: number; query?: string } = {},
): Promise<ChatFile[]> {
  const files: ChatFile[] = [];
  const keyword = options.query?.trim().toLocaleLowerCase() ?? '';
  const walk = async (app: ChatApp, dir: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRECTORIES.has(entry.name))
          await walk(app, path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (keyword && !entry.name.toLocaleLowerCase().includes(keyword)) continue;
      const info = await stat(path).catch(() => null);
      if (!info || (options.sinceMs !== undefined && info.mtimeMs < options.sinceMs)) continue;
      files.push({
        app,
        name: entry.name,
        path,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  };
  for (const root of roots) await walk(root.app, root.path, 0);
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
