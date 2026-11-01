import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => settings.set(key, value),
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
import { getDatabase } from '../../database';
import { outlookWebState, rowsSince, saveRows, searchRows } from '../store';

const AT = '2026-11-01T00:00:00Z';
const row = (id: string, label = `邮件 ${id}`) => ({ id, label });
let db: DatabaseSync;

beforeEach(() => {
  settings.clear();
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE outlook_web_mail (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, first_seen TEXT NOT NULL)',
  );
  vi.mocked(getDatabase).mockReturnValue({
    prepare: (sql: string) => db.prepare(sql),
  } as unknown as ReturnType<typeof getDatabase>);
});

describe('outlook-web store', () => {
  it('页面最上面的邮件排最新，列表按新到旧', () => {
    expect(saveRows([row('new'), row('old')], AT)).toBe(2);
    expect(outlookWebState().rows.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('再读到同一封只更新描述，不算新邮件', () => {
    saveRows([row('a', '未读 邮件')], AT);
    expect(saveRows([row('a', '已读 邮件')], AT)).toBe(0);
    expect(rowsSince(undefined).labels).toEqual(['已读 邮件']);
  });

  it('第一次只取最新 20 封，之后按游标取新增', () => {
    saveRows(
      Array.from({ length: 30 }, (_, index) => row(`m${index}`)),
      AT,
    );
    const first = rowsSince(undefined);
    expect(first.labels).toHaveLength(20);
    expect(first.labels[0]).toBe('邮件 m0');
    saveRows([row('fresh'), row('m0')], AT);
    const next = rowsSince(first.cursor);
    expect(next.labels).toEqual(['邮件 fresh']);
    expect(rowsSince(next.cursor).labels).toEqual([]);
  });

  it('搜索任一词命中，百分号不当通配符', () => {
    saveRows([row('a', 'Coursework 反馈'), row('b', '图书馆通知')], AT);
    expect(searchRows('coursework 讲座').map((item) => item.id)).toEqual(['a']);
    expect(searchRows('%')).toEqual([]);
    expect(searchRows(' ')).toEqual([]);
  });
});
