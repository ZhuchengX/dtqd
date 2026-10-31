// 全局搜索里的 Teams 存档：在本机 ~/Documents/DTQD/teams 下的会话存档里逐行匹配，点开用系统默认程序打开。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { shell } from 'electron';

/** 汇总文件不是会话存档，不进搜索结果。 */
const SKIPPED = new Set(['最近更新.md', '待办提取.md']);
const MAX_FILES = 2000;
const SNIPPET_CHARS = 80;

export interface TeamsArchiveHit {
  path: string;
  title: string;
  snippet: string;
}

function archiveFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (files.length >= MAX_FILES || name.startsWith('.')) continue;
      const path = join(dir, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat?.isDirectory()) walk(path);
      else if (stat?.isFile() && name.endsWith('.md') && !SKIPPED.has(name)) files.push(path);
    }
  };
  walk(root);
  return files;
}

/** 文件里第一处命中所在的那一行（去掉 Markdown 标记）作为摘要；会话名也算命中。 */
export function searchTeamsArchive(root: string, query: string, limit: number): TeamsArchiveHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: TeamsArchiveHit[] = [];
  for (const path of archiveFiles(root)) {
    if (hits.length >= limit) break;
    const title = relative(root, path).replace(/\.md$/, '').split(sep).join(' › ');
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const line = text.split('\n').find((row) => row.toLocaleLowerCase().includes(needle));
    if (!line && !title.toLocaleLowerCase().includes(needle)) continue;
    hits.push({
      path,
      title,
      snippet: (line ?? '')
        .replace(/^#+\s*/, '')
        .trim()
        .slice(0, SNIPPET_CHARS),
    });
  }
  return hits;
}

/** 只打开 Teams 存档目录里的文件，防止页面借这个接口打开任意路径。 */
export async function openTeamsArchiveFile(root: string, path: string): Promise<void> {
  const target = resolve(path);
  const base = resolve(root) + sep;
  if (!target.startsWith(base) || !target.endsWith('.md'))
    throw new Error('只能打开 Teams 存档里的文件');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}
