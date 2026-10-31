import { app } from 'electron';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getDatabase } from './database';

export function storageDirectory() {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='directory'")
    .get() as { value: string } | undefined;
  return row?.value ?? defaultStorageDirectory();
}

// DTQD 新用户默认 文档/DTQD；已有上游 文档/Dela 的用户继续沿用旧目录，不迁移不删除。
function defaultStorageDirectory() {
  const legacy = join(app.getPath('documents'), 'Dela');
  return existsSync(legacy) ? legacy : join(app.getPath('documents'), 'DTQD');
}

// A single path component, including Windows device names and trailing dots/spaces.
export function diskName(name: string) {
  let value = name
    // oxlint-disable-next-line no-control-regex -- Windows filenames prohibit C0 control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!value) value = 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value;
}

export function availablePath(parent: string, name: string, folder = false) {
  const safe = diskName(name);
  const extension = folder ? '' : extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let path = join(parent, safe);
  for (let index = 2; existsSync(path); index += 1)
    path = join(parent, `${stem} (${index})${extension}`);
  return path;
}
