import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => settings.set(key, value),
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../../campus', () => ({ getCampusSession: vi.fn(async () => ({ fetch: vi.fn() })) }));
import { getDatabase } from '../../database';
import { archiveNotices, readNotice, refreshNoticeArchive, searchNotices } from '../notice-archive';

const notice = (title: string, date: string, body: string | null = null) => ({
  title,
  date,
  body,
  site: '本科生院',
  url: `https://bksy.csu.edu.cn/info/1/${title}.htm`,
});

let db: DatabaseSync;

beforeEach(() => {
  settings.clear();
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE campus_notices (url TEXT PRIMARY KEY, site TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, body TEXT)',
  );
  vi.mocked(getDatabase).mockReturnValue({
    prepare: (sql: string) => db.prepare(sql),
  } as unknown as ReturnType<typeof getDatabase>);
});

describe('searchNotices', () => {
  it('学生说保研也能查到写着推免的通知', () => {
    archiveNotices([notice('2027届推免工作通知', '2026-09-01'), notice('食堂通知', '2026-09-02')]);
    expect(searchNotices('保研').map((hit) => hit.title)).toEqual(['2027届推免工作通知']);
  });

  it('标题命中排在正文命中前面，同分新的在前', () => {
    archiveNotices([
      notice('其他事项', '2026-10-01', '正文提到实习'),
      notice('暑期实习 A', '2026-06-01'),
      notice('暑期实习 B', '2026-08-01'),
    ]);
    expect(searchNotices('实习').map((hit) => hit.title)).toEqual([
      '暑期实习 B',
      '暑期实习 A',
      '其他事项',
    ]);
  });

  it('关键词里的百分号不当通配符，空查询没有结果', () => {
    archiveNotices([notice('食堂通知', '2026-09-02')]);
    expect(searchNotices('%')).toEqual([]);
    expect(searchNotices('  ')).toEqual([]);
  });

  it('摘要取正文里命中的那一段', () => {
    archiveNotices([notice('通知', '2026-09-01', `${'无关'.repeat(100)}报名截止 10 月 8 日`)]);
    expect(searchNotices('报名截止')[0]?.snippet).toContain('报名截止 10 月 8 日');
  });
});

describe('archiveNotices', () => {
  it('再次写入只有标题时不抹掉已读的正文', () => {
    archiveNotices([notice('通知', '2026-09-01', '正文')]);
    archiveNotices([notice('通知', '2026-09-01')]);
    expect(searchNotices('正文')).toHaveLength(1);
  });
});

describe('readNotice', () => {
  it('存档外的链接不读取', async () => {
    const fetcher = vi.fn();
    expect(await readNotice('https://evil.example/x', fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('第一次联网读正文并存下，第二次不再联网', async () => {
    const item = notice('通知', '2026-09-01');
    archiveNotices([item]);
    const fetcher = vi.fn(async () => '<div class="v_news_content">报名方式</div>');
    expect((await readNotice(item.url, fetcher))?.body).toContain('报名方式');
    expect((await readNotice(item.url, fetcher))?.body).toContain('报名方式');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('refreshNoticeArchive', () => {
  it('一个站打不开不影响其他站，一天内不重复刷新', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('dii.csu')) throw new Error('down');
      return `<a href="info/1/${fetcher.mock.calls.length}.htm" title="通知">通知</a><span>2026-09-01</span>`;
    });
    const now = Date.parse('2026-11-01T00:00:00Z');
    await refreshNoticeArchive(now, fetcher);
    const rows = db.prepare('SELECT count(*) AS n FROM campus_notices').get() as { n: number };
    expect(rows.n).toBeGreaterThan(0);
    const calls = fetcher.mock.calls.length;
    await refreshNoticeArchive(now + 3_600_000, fetcher);
    expect(fetcher.mock.calls.length).toBe(calls);
  });
});
