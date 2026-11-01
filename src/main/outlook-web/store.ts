// Outlook 网页版读到的收件箱列表，存本机。seq 越大越新，重要事项按 seq 增量取。
import type { OutlookWebRow, OutlookWebState, OutlookWebStatus } from '../../shared/outlook-web';
import { getDatabase } from '../database';
import { readSetting, writeSetting } from '../settings/prefs';

const CONNECTED_KEY = 'outlook-web-connected';
const LAST_SYNC_KEY = 'outlook-web-last-sync';
const LAST_STATUS_KEY = 'outlook-web-last-status';
const STATE_ROWS = 200;
/** 第一次连接只把最新这么多封当作新邮件，免得整个收件箱都进重要事项。 */
const FIRST_READ_ROWS = 20;
const SEARCH_LIMIT = 15;

export interface ScrapedRow {
  id: string;
  label: string;
}

interface StoredRow {
  seq: number;
  id: string;
  label: string;
  first_seen: string;
}

export function outlookWebConnected(): boolean {
  return readSetting(CONNECTED_KEY) === '1';
}

export function markOutlookWebConnected(): void {
  writeSetting(CONNECTED_KEY, '1');
}

export function recordOutlookWebSync(status: OutlookWebStatus, at: string): void {
  writeSetting(LAST_STATUS_KEY, status);
  if (status === 'ok') writeSetting(LAST_SYNC_KEY, at);
}

/** rows 按页面顺序（新的在前）；倒着写入，让新邮件拿到更大的 seq。已有的只更新描述。 */
export function saveRows(rows: readonly ScrapedRow[], at: string): number {
  const db = getDatabase();
  const exists = db.prepare('SELECT 1 FROM outlook_web_mail WHERE id=?');
  const insert = db.prepare(
    'INSERT INTO outlook_web_mail (id, label, first_seen) VALUES (?, ?, ?)',
  );
  const update = db.prepare('UPDATE outlook_web_mail SET label=? WHERE id=?');
  let added = 0;
  for (const { id, label } of [...rows].reverse()) {
    if (exists.get(id)) {
      update.run(label, id);
    } else {
      insert.run(id, label, at);
      added += 1;
    }
  }
  return added;
}

function toRow(row: StoredRow): OutlookWebRow {
  return { id: row.id, label: row.label, firstSeen: row.first_seen };
}

export function outlookWebState(): OutlookWebState {
  const rows = getDatabase()
    .prepare('SELECT seq, id, label, first_seen FROM outlook_web_mail ORDER BY seq DESC LIMIT ?')
    .all(STATE_ROWS) as unknown as StoredRow[];
  return {
    connected: outlookWebConnected(),
    lastSyncAt: readSetting(LAST_SYNC_KEY) ?? null,
    lastStatus: (readSetting(LAST_STATUS_KEY) as OutlookWebStatus | undefined) ?? null,
    rows: rows.map(toRow),
  };
}

/** 游标之后的新邮件，返回给重要事项的正文和新游标。 */
export function rowsSince(cursor: string | undefined): {
  labels: string[];
  cursor: string | undefined;
} {
  const db = getDatabase();
  const rows = (cursor
    ? db
        .prepare(
          'SELECT seq, id, label, first_seen FROM outlook_web_mail WHERE seq > ? ORDER BY seq DESC',
        )
        .all(Number(cursor))
    : db
        .prepare(
          'SELECT seq, id, label, first_seen FROM outlook_web_mail ORDER BY seq DESC LIMIT ?',
        )
        .all(FIRST_READ_ROWS)) as unknown as StoredRow[];
  return {
    labels: rows.map((row) => row.label),
    cursor: rows[0] ? String(rows[0].seq) : cursor,
  };
}

/** 按空格分词，任一词命中就返回，新的在前。 */
export function searchRows(query: string): OutlookWebRow[] {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return [];
  const where = words.map(() => "label LIKE ? ESCAPE '!'").join(' OR ');
  const patterns = words.map((word) => `%${word.replace(/[!%_]/g, '!$&')}%`);
  const rows = getDatabase()
    .prepare(
      `SELECT seq, id, label, first_seen FROM outlook_web_mail WHERE ${where} ORDER BY seq DESC LIMIT ?`,
    )
    .all(...patterns, SEARCH_LIMIT) as unknown as StoredRow[];
  return rows.map(toRow);
}
