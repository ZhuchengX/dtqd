// 学校通知存档：把各站通知的标题、日期、链接存到本机，聊天里能按关键词查，回答时带来源。
// 重要事项只看新通知；这里还多存就业、考研等几个站，它们量大，不进重要事项提取。
import { getDatabase } from '../database';
import { readSetting, writeSetting } from '../settings/prefs';
import {
  CAMPUS_WEB_SITES,
  careerBody,
  fetchOfficeNotices,
  fetchPage,
  nextPageUrl,
  noticeBody,
  officeBody,
  parseAdmissionsNews,
  parseCareerNews,
  parseNoticeList,
  type CampusNotice,
  type CampusWebSite,
} from './campus-web';

export const ARCHIVE_ONLY_SITES: readonly CampusWebSite[] = [
  { name: '中南大学研究生院 · 通知', url: 'https://gra.csu.edu.cn/yjsytz.htm' },
  { name: '中南大学研招网 · 硕士招生通知', url: 'https://yz.csu.edu.cn/sszs/tzgg.htm' },
  { name: '中南大学研招网 · 招生简章', url: 'https://yz.csu.edu.cn/sszs/zsjz.htm' },
  { name: '就业信息网 · 招聘', url: 'https://career.csu.edu.cn/campus/index/category/1' },
  { name: '就业信息网 · 实习', url: 'https://career.csu.edu.cn/campus/index/category/2' },
  { name: '就业信息网 · 考研调剂', url: 'https://career.csu.edu.cn/news/index/tag/kytj' },
  { name: '就业信息网 · 科研助理', url: 'https://career.csu.edu.cn/news/index/tag/kyzl' },
  { name: '就业信息网 · 选调公考', url: 'https://career.csu.edu.cn/news/index/tag/jcxm' },
  { name: '就业信息网 · 国际组织', url: 'https://career.csu.edu.cn/news/index/tag/gjzz' },
];

/** 学生说的词和通知里的词常常不同（保研 / 推免），查询时一起查。 */
const SYNONYMS: Record<string, readonly string[]> = {
  保研: ['推免', '推荐免试', '免试攻读'],
  考研: ['硕士研究生', '调剂', '研究生招生'],
  竞赛: ['大赛', '挑战杯', '互联网+'],
  比赛: ['大赛', '竞赛', '挑战杯'],
  奖学金: ['奖助', '资助'],
  留学: ['交流项目', '出国', '境外'],
  工作: ['招聘', '就业'],
};

const SYNC_KEY = 'notice-archive-synced';
const SYNC_INTERVAL_MS = 24 * 3_600_000;
/** 第一次往回多翻几页把历史补上，之后每天只看最新两页。 */
const FIRST_SYNC_PAGES = 15;
const DAILY_SYNC_PAGES = 2;
const MAX_KEYWORDS = 8;
const MAX_CANDIDATES = 500;
const SNIPPET_CHARS = 120;
const MAX_READ_CHARS = 8000;
const SYNONYM_WEIGHT = 1;
const TITLE_WEIGHT = 3;

export interface ArchivedNotice extends CampusNotice {
  site: string;
  body?: string | null;
}

export interface NoticeHit {
  title: string;
  site: string;
  date: string;
  url: string;
  snippet: string;
}

interface NoticeRow {
  url: string;
  site: string;
  title: string;
  date: string;
  body: string | null;
}

export function archiveNotices(notices: readonly ArchivedNotice[]): void {
  const upsert = getDatabase().prepare(
    `INSERT INTO campus_notices (url, site, title, date, body) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET site=excluded.site, title=excluded.title, date=excluded.date,
       body=coalesce(excluded.body, campus_notices.body)`,
  );
  for (const { url, site, title, date, body } of notices)
    upsert.run(url, site, title, date, body || null);
}

function parseList(html: string, url: string): CampusNotice[] {
  if (url.includes('yz.csu.edu.cn')) return parseAdmissionsNews(html, url);
  return url.includes('/news/index/') ? parseCareerNews(html, url) : parseNoticeList(html, url);
}

async function archiveSite(
  site: CampusWebSite,
  fetcher: typeof fetchPage,
  maxPages: number,
): Promise<void> {
  let url: string | null = site.url;
  for (let page = 0; url && page < maxPages; page += 1) {
    const html: string = await fetcher(url);
    archiveNotices(parseList(html, url).map((notice) => ({ ...notice, site: site.name })));
    url = nextPageUrl(html, url);
  }
}

async function archiveOffice(): Promise<void> {
  const notices = await fetchOfficeNotices();
  archiveNotices((notices ?? []).map((n) => ({ ...n, site: '中南大学校内办公网' })));
}

let refreshing: Promise<void> | null = null;

/** 一天最多刷新一次；一个站打不开不影响其他站，也不算失败，明天再试。 */
export function refreshNoticeArchive(
  now: number,
  fetcher: typeof fetchPage = fetchPage,
): Promise<void> {
  const last = Number(readSetting(SYNC_KEY) ?? 0);
  if (now - last < SYNC_INTERVAL_MS) return Promise.resolve();
  refreshing ??= (async () => {
    const tasks = [
      ...[...CAMPUS_WEB_SITES, ...ARCHIVE_ONLY_SITES].map(
        (site) => () =>
          archiveSite(site, fetcher, last === 0 ? FIRST_SYNC_PAGES : DAILY_SYNC_PAGES),
      ),
      archiveOffice,
    ];
    for (const task of tasks) {
      await task().catch((error: unknown) =>
        console.error('[notices] 刷新失败', error instanceof Error ? error.message : ''),
      );
    }
    writeSetting(SYNC_KEY, String(now));
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function likePattern(keyword: string): string {
  return `%${keyword.replace(/[!%_]/g, '!$&')}%`;
}

function snippetOf(row: NoticeRow, words: readonly string[]): string {
  const body = row.body?.replace(/\s+/g, ' ') ?? '';
  const at = words.map((word) => body.indexOf(word)).find((index) => index >= 0);
  return at === undefined
    ? body.slice(0, SNIPPET_CHARS)
    : body.slice(Math.max(0, at - 20), at + SNIPPET_CHARS);
}

/** 按空格分词，每个词连同近义词一起查；原词命中比近义词分高，标题比正文分高，同分新的在前。 */
export function searchNotices(query: string, limit = 10): NoticeHit[] {
  const typed = [...new Set(query.split(/\s+/).filter(Boolean))].slice(0, MAX_KEYWORDS);
  if (typed.length === 0) return [];
  const related = typed.flatMap((word) => SYNONYMS[word] ?? []);
  const words = [...new Set([...typed, ...related])];
  const where = words.map(() => "(title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!')").join(' OR ');
  const rows = getDatabase()
    .prepare(
      `SELECT url, site, title, date, body FROM campus_notices WHERE ${where} ORDER BY date DESC LIMIT ?`,
    )
    .all(
      ...words.flatMap((word) => [likePattern(word), likePattern(word)]),
      MAX_CANDIDATES,
    ) as unknown as NoticeRow[];
  const weight = (word: string) => (typed.includes(word) ? 2 : SYNONYM_WEIGHT);
  const score = (row: NoticeRow) =>
    words.reduce(
      (sum, word) =>
        sum +
        weight(word) *
          ((row.title.includes(word) ? TITLE_WEIGHT : 0) + (row.body?.includes(word) ? 1 : 0)),
      0,
    );
  return rows
    .map((row) => ({ row, points: score(row) }))
    .sort((a, b) => b.points - a.points || b.row.date.localeCompare(a.row.date))
    .slice(0, limit)
    .map(({ row }) => ({
      title: row.title,
      site: row.site,
      date: row.date,
      url: row.url,
      snippet: snippetOf(row, words),
    }));
}

async function fetchBody(url: string, fetcher: typeof fetchPage): Promise<string> {
  if (url.includes('/con/PDFPage')) return officeBody(url);
  const html = await fetcher(url);
  return url.includes('career.csu.edu.cn') ? careerBody(html) : noticeBody(html);
}

/** 只读存档里有的链接（防止模型借此访问任意地址）；正文读过一次就存下来。 */
export async function readNotice(
  url: string,
  fetcher: typeof fetchPage = fetchPage,
): Promise<(NoticeHit & { body: string }) | null> {
  const db = getDatabase();
  const row = db
    .prepare('SELECT url, site, title, date, body FROM campus_notices WHERE url=?')
    .get(url) as unknown as NoticeRow | undefined;
  if (!row) return null;
  const body = row.body ?? (await fetchBody(url, fetcher));
  if (!row.body && body) db.prepare('UPDATE campus_notices SET body=? WHERE url=?').run(body, url);
  return {
    title: row.title,
    site: row.site,
    date: row.date,
    url: row.url,
    snippet: '',
    body: body.slice(0, MAX_READ_CHARS),
  };
}

export function noticeArchiveEmpty(): boolean {
  return !getDatabase().prepare('SELECT 1 FROM campus_notices LIMIT 1').get();
}
