// Teams 存档命令：私聊跟随开关、id 不能越出存档目录、消息解析与翻页。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', login: true, teamsPrivate: false }));
vi.mock('electron', () => ({ shell: {} }));
vi.mock('../../../../teams/sync', () => ({
  teamsDirectory: () => state.root,
  hasTeamsLogin: () => state.login,
}));
vi.mock('../../../../inbox/prefs', () => ({
  inboxPrefs: () => ({ teamsPrivate: state.teamsPrivate }),
}));

import { parseArchiveMessages, teamsArchiveTools } from '../archive';

const { list_teams_archive: list, read_teams_archive: read } = teamsArchiveTools;
const search = teamsArchiveTools.search_teams_archive;
type ListResult = { items: { id: string; kind: string }[]; coverage: { warnings?: string[] } };

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dtqd-teams-tools-'));
  state.login = true;
  state.teamsPrivate = false;
  mkdirSync(join(state.root, '频道'));
  mkdirSync(join(state.root, '私聊'));
  mkdirSync(join(state.root, '其他'));
  writeFileSync(
    join(state.root, '频道', 'MA22004.md'),
    '# [频道] MA22004\n\n### 2026-10-30 09:00 · Dr Smith\n\nCoursework 2 due Friday\n\n### 2026-10-31 10:00 · Dr Lee · TA\n\nroom change\n',
  );
  writeFileSync(
    join(state.root, '私聊', 'Alice.md'),
    '### 2026-10-30 09:00 · Alice\n\nsecret deadline\n',
  );
  writeFileSync(
    join(state.root, '其他', 'Unknown.md'),
    '### 2026-10-30 09:00 · Bob\n\nsecret deadline\n',
  );
  writeFileSync(join(state.root, '最近更新.md'), 'secret deadline Coursework');
});

describe('Teams 存档命令', () => {
  it('私聊开关关闭时只列出频道等群组会话，并说明已隐藏', () => {
    const result = list.execute({}) as ListResult;
    expect(result.items.map((item) => item.id)).toEqual(['频道/MA22004.md']);
    expect(result.coverage.warnings?.[0]).toContain('私聊已隐藏');
  });

  it('私聊开关打开后列出全部，汇总文件仍不算会话', () => {
    state.teamsPrivate = true;
    const result = list.execute({}) as ListResult;
    expect(result.items.map((item) => item.id).sort()).toEqual([
      '其他/Unknown.md',
      '私聊/Alice.md',
      '频道/MA22004.md',
    ]);
  });

  it('开关关闭时读私聊和「其他」都被拒绝', () => {
    for (const id of ['私聊/Alice.md', '其他/Unknown.md'])
      expect(() => read.execute({ id })).toThrowError(
        expect.objectContaining({ code: 'NOT_CONFIGURED' }),
      );
  });

  it('开关关闭时搜不到私聊内容', () => {
    expect((search.execute({ query: 'secret' }) as ListResult).items).toEqual([]);
    state.teamsPrivate = true;
    expect((search.execute({ query: 'secret' }) as ListResult).items).toHaveLength(2);
  });

  it('id 不能越出存档目录，也不能读汇总文件', () => {
    for (const id of ['../secret.md', '频道/../../secret.md', '最近更新.md', '.sync-state.json'])
      expect(() => read.execute({ id })).toThrow();
    state.teamsPrivate = true;
    expect(() => read.execute({ id: '最近更新.md' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('消息最新在前，可翻页；发送人名字里可以有分隔符', () => {
    const first = read.execute({ id: '频道/MA22004.md', limit: 1 }) as {
      items: { time: string; author: string; text: string }[];
      nextOffset: number | null;
    };
    expect(first.items).toEqual([
      { time: '2026-10-31 10:00', author: 'Dr Lee · TA', text: 'room change' },
    ]);
    expect(first.nextOffset).toBe(1);
    const second = read.execute({ id: '频道/MA22004.md', limit: 1, offset: 1 }) as {
      items: { text: string }[];
      nextOffset: number | null;
    };
    expect(second.items[0]!.text).toBe('Coursework 2 due Friday');
    expect(second.nextOffset).toBeNull();
  });

  it('没登录也没存档时报 NOT_CONFIGURED', () => {
    state.root = mkdtempSync(join(tmpdir(), 'dtqd-teams-empty-'));
    state.login = false;
    expect(() => list.execute({})).toThrowError(
      expect.objectContaining({ code: 'NOT_CONFIGURED' }),
    );
  });

  it('解析时忽略文件标题，正文里可以有空行', () => {
    expect(parseArchiveMessages('# 标题\n\n### t · a\n\nline1\n\nline2\n')).toEqual([
      { time: 't', author: 'a', text: 'line1\n\nline2' },
    ]);
  });
});
