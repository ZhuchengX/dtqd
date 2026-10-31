import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(async () => '') }));
vi.mock('electron', () => ({ shell: { openPath } }));
import { openTeamsArchiveFile, searchTeamsArchive } from '../teams-archive';

let root: string;

beforeEach(() => {
  openPath.mockClear();
  root = mkdtempSync(join(tmpdir(), 'dtqd-teams-'));
  mkdirSync(join(root, '频道'));
  writeFileSync(
    join(root, '频道', 'DIICSU Maths › MA22004.md'),
    '### 2026-10-30 09:00 · Dr Smith\n\nCoursework 2 deadline moved to Friday\n',
  );
  writeFileSync(join(root, '最近更新.md'), 'Coursework 2 deadline');
});

describe('searchTeamsArchive', () => {
  it('逐行匹配会话存档，摘要是命中的那行；汇总文件不算', () => {
    expect(searchTeamsArchive(root, 'coursework', 10)).toEqual([
      {
        path: join(root, '频道', 'DIICSU Maths › MA22004.md'),
        title: '频道 › DIICSU Maths › MA22004',
        snippet: 'Coursework 2 deadline moved to Friday',
      },
    ]);
  });

  it('会话名命中也算；空查询、没有存档目录时为空', () => {
    expect(searchTeamsArchive(root, 'ma22004', 10)).toHaveLength(1);
    expect(searchTeamsArchive(root, '  ', 10)).toEqual([]);
    expect(searchTeamsArchive(join(root, 'none'), 'x', 10)).toEqual([]);
  });
});

describe('openTeamsArchiveFile', () => {
  it('只打开存档目录里的 .md', async () => {
    await openTeamsArchiveFile(root, join(root, '频道', 'DIICSU Maths › MA22004.md'));
    expect(openPath).toHaveBeenCalledTimes(1);
    await expect(openTeamsArchiveFile(root, join(root, '..', 'secret.md'))).rejects.toThrow();
    await expect(openTeamsArchiveFile(root, join(root, 'a.app'))).rejects.toThrow();
    expect(openPath).toHaveBeenCalledTimes(1);
  });
});
