import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => settings.set(key, value),
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../canvas/api', () => ({ listTodoCanvasCourses: vi.fn() }));
vi.mock('../../chatfiles/scan', () => ({ defaultChatFileRoots: vi.fn(), listChatFiles: vi.fn() }));
vi.mock('../../teams/sync', () => ({ hasTeamsLogin: vi.fn(() => false), syncTeams: vi.fn() }));
vi.mock('../engine', () => ({ formatTime: (time: number) => new Date(time).toISOString() }));
import { getDatabase } from '../../database';
import { listTodoCanvasCourses } from '../../canvas/api';
import { defaultChatFileRoots, listChatFiles } from '../../chatfiles/scan';
import { hasTeamsLogin, syncTeams } from '../../teams/sync';
import {
  currentCourses,
  FIRST_LOOKBACK_DAYS,
  readMyDundee,
  readOutlook,
  readQq,
  readTeams,
  tagCourses,
} from '../sources';

const NOW = Date.parse('2026-10-31T12:00:00Z');
let db: DatabaseSync;

beforeEach(() => {
  settings.clear();
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE canvas_courses (id INTEGER PRIMARY KEY, data TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY);
    CREATE TABLE mail_messages (id INTEGER PRIMARY KEY, subject TEXT, sender_name TEXT, sender_address TEXT, date TEXT, body_text TEXT, snippet TEXT, deleted_at TEXT);
  `);
  vi.mocked(getDatabase).mockReturnValue({
    prepare: (sql: string) => db.prepare(sql),
  } as unknown as ReturnType<typeof getDatabase>);
});

function announce(id: string, updatedAt: string, title = '公告') {
  db.prepare('INSERT INTO canvas_sources VALUES (?, 1, ?)').run(
    `bbann:c1:${id}`,
    JSON.stringify({ courseId: 1, title, html: '<p>Deadline <b>Friday</b></p>', updatedAt }),
  );
}

describe('readMyDundee', () => {
  it('没连 myDundee 时是 not-connected', () => {
    expect(readMyDundee(undefined, NOW).status).toBe('not-connected');
  });

  it('首次只取最近 14 天，带课程名与纯文本正文；游标推进到最新一条', () => {
    settings.set('blackboard-user', 'x');
    db.prepare('INSERT INTO canvas_courses (id, data) VALUES (1, ?)').run(
      JSON.stringify({ code: 'DI12006', name: 'Statistics' }),
    );
    announce('old', '2026-09-01T00:00:00Z', '旧公告');
    announce('new', '2026-10-30T08:00:00Z', '新公告');
    const read = readMyDundee(undefined, NOW);
    expect(read).toMatchObject({ status: 'ok', newItems: 1, cursor: '2026-10-30T08:00:00Z' });
    expect(read.text).toContain('DI12006 Statistics · 新公告');
    expect(read.text).toContain('Deadline Friday');
    expect(read.text).not.toContain('旧公告');
    expect(readMyDundee(read.cursor, NOW)).toMatchObject({ newItems: 0, text: '' });
  });
});

describe('readOutlook', () => {
  it('没有邮箱账号时是 not-connected', () => {
    expect(readOutlook(undefined, NOW).status).toBe('not-connected');
  });

  it('首次按日期取最近 14 天，之后按行 id 增量，已删的不要', () => {
    db.exec('INSERT INTO mail_accounts VALUES (1)');
    const insert = db.prepare(
      'INSERT INTO mail_messages (id, subject, sender_name, date, body_text, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insert.run(1, '旧邮件', 'A', '2026-08-01T00:00:00Z', 'old', null);
    insert.run(2, 'Resit 安排', 'Registry', '2026-10-30T00:00:00Z', 'resit body', null);
    insert.run(3, '已删', 'B', '2026-10-30T00:00:00Z', 'x', '2026-10-30');
    const first = readOutlook(undefined, NOW);
    expect(first).toMatchObject({ status: 'ok', newItems: 1, cursor: '2' });
    expect(first.text).toContain('Resit 安排 · Registry');
    insert.run(4, '新邮件', 'C', '2026-10-31T00:00:00Z', 'new', null);
    expect(readOutlook(first.cursor, NOW)).toMatchObject({ newItems: 1, cursor: '4' });
  });
});

describe('readQq / readTeams / currentCourses', () => {
  it('没有 QQ 接收文件夹时是 not-connected；有则列出新文件名', async () => {
    vi.mocked(defaultChatFileRoots).mockResolvedValue([]);
    expect((await readQq(undefined, NOW)).status).toBe('not-connected');
    vi.mocked(defaultChatFileRoots).mockResolvedValue([{ app: 'qq', path: '/qq' }]);
    vi.mocked(listChatFiles).mockResolvedValue([
      {
        app: 'qq',
        name: '期末考试安排.pdf',
        path: '/qq/a',
        size: 1,
        modifiedAt: '2026-10-30T00:00:00Z',
      },
    ]);
    const read = await readQq(undefined, NOW);
    expect(read).toMatchObject({ status: 'ok', newItems: 1 });
    expect(read.text).toContain('期末考试安排.pdf');
  });

  it('没登录过 Teams 时是 not-connected，不打开窗口', async () => {
    expect(await readTeams()).toMatchObject({ status: 'not-connected', newItems: 0 });
  });

  it('Teams 按重要事项自己的游标取汇总，成功才给新游标', async () => {
    vi.mocked(hasTeamsLogin).mockReturnValue(true);
    vi.mocked(listTodoCanvasCourses).mockResolvedValue([]);
    vi.mocked(syncTeams).mockResolvedValue({
      status: 'ok',
      newMessages: 0,
      conversations: 0,
      groupDigest: '上次没进队列的消息',
      privateDigest: '',
      latest: 2000,
    });
    const read = await readTeams('1000', true, NOW);
    expect(syncTeams).toHaveBeenLastCalledWith(1000);
    expect(read).toMatchObject({ text: '上次没进队列的消息', cursor: '2000' });

    await readTeams(undefined, true, NOW);
    expect(syncTeams).toHaveBeenLastCalledWith(NOW - FIRST_LOOKBACK_DAYS * 86_400_000);

    // 提取关着时不重读。
    await readTeams(undefined, false, NOW);
    expect(syncTeams).toHaveBeenLastCalledWith(undefined);

    vi.mocked(syncTeams).mockResolvedValue({ status: 'busy', newMessages: 0, conversations: 0 });
    expect((await readTeams('1000', true, NOW)).cursor).toBeUndefined();
    vi.mocked(hasTeamsLogin).mockReturnValue(false);
  });

  it('课程列表拼成「代码 名称」，出错时为空', async () => {
    vi.mocked(listTodoCanvasCourses).mockResolvedValue([
      { id: 1, code: 'DI12006', name: 'Statistics' },
    ]);
    expect(await currentCourses()).toEqual(['DI12006 Statistics']);
    vi.mocked(listTodoCanvasCourses).mockRejectedValue(new Error('offline'));
    expect(await currentCourses()).toEqual([]);
  });
});

describe('tagCourses', () => {
  it('会话标题含课程代码或较长的课程名时标上课程，正文行不动', () => {
    const digest = [
      '## [频道] DIICSU Maths › MA22004',
      'MA22004 in body',
      '## [群聊] Engineering Mathematics study group',
      '## [私聊] Alice',
    ].join('\n');
    expect(
      tagCourses(digest, ['MA22004 Statistics', 'EG21003 Engineering Mathematics', 'X1 Art']),
    ).toBe(
      [
        '## [频道] DIICSU Maths › MA22004（课程：MA22004 Statistics）',
        'MA22004 in body',
        '## [群聊] Engineering Mathematics study group（课程：EG21003 Engineering Mathematics）',
        '## [私聊] Alice',
      ].join('\n'),
    );
    expect(tagCourses(digest, [])).toBe(digest);
  });
});
