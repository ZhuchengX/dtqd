// 重要事项各来源的增量读取：每个来源只读上次以来的新内容，游标存在 workspace_settings 的 inbox-cursors。
// Teams 走隐藏窗口读 Teams 网页客户端自己的缓存；myDundee 公告与邮件读本地库；QQ 只列接收文件夹里的新文件名。
import type { InboxSource, InboxSourceStatusKind } from '../../shared/inbox';
import { listTodoCanvasCourses } from '../canvas/api';
import { defaultChatFileRoots, listChatFiles } from '../chatfiles/scan';
import { readCampusWebSites } from './campus-web';
import { getDatabase } from '../database';
import { readSetting, writeSetting } from '../settings/prefs';
import { htmlToText } from '../teams/extract';
import { hasTeamsLogin, syncTeams } from '../teams/sync';
import { formatTime } from './engine';

/** 首次读取某来源时只往回看这么多天，免得把整学期旧消息都当成新消息。 */
export const FIRST_LOOKBACK_DAYS = 14;
const MAX_ITEM_CHARS = 1500;

export interface SourceRead {
  source: InboxSource;
  status: InboxSourceStatusKind;
  newItems: number;
  text: string;
  detail: string | null;
  /** 读取成功后要保存的新游标；undefined 表示游标不变。 */
  cursor?: string;
}

type Cursors = Partial<Record<InboxSource, string>>;

export function readCursors(): Cursors {
  try {
    return JSON.parse(readSetting('inbox-cursors') ?? '{}') as Cursors;
  } catch {
    return {};
  }
}

export function saveCursors(cursors: Cursors): void {
  writeSetting('inbox-cursors', JSON.stringify(cursors));
}

function firstSince(now: number): number {
  return now - FIRST_LOOKBACK_DAYS * 86_400_000;
}

function clip(text: string): string {
  return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text;
}

export async function readTeams(): Promise<SourceRead> {
  if (!hasTeamsLogin())
    return {
      source: 'teams',
      status: 'not-connected',
      newItems: 0,
      text: '',
      detail: '在侧栏点 Teams 登录一次后自动同步',
    };
  const result = await syncTeams();
  const status: InboxSourceStatusKind =
    result.status === 'ok'
      ? 'ok'
      : result.status === 'needs-login'
        ? 'needs-login'
        : result.status === 'busy'
          ? 'idle'
          : 'not-ready';
  const detail =
    result.status === 'needs-login'
      ? 'Teams 登录已过期，点侧栏 Teams 重新登录'
      : result.status === 'not-ready'
        ? 'Teams 两分钟内没加载完，稍后自动重试'
        : null;
  return {
    source: 'teams',
    status,
    newItems: result.newMessages,
    text: result.newMessages > 0 ? tagCourses(result.digest ?? '', await currentCourses()) : '',
    detail,
  };
}

interface Announcement {
  courseId: number;
  title: string;
  html?: string;
  updatedAt?: string | null;
}

export function readMyDundee(cursor: string | undefined, now: number): SourceRead {
  const db = getDatabase();
  const connected = Boolean(readSetting('blackboard-user'));
  if (!connected)
    return {
      source: 'mydundee',
      status: 'not-connected',
      newItems: 0,
      text: '',
      detail: '在设置 › 连接里连接 myDundee',
    };
  const since = cursor ? Date.parse(cursor) : firstSince(now);
  const names = new Map(
    (db.prepare('SELECT id, data FROM canvas_courses').all() as { id: number; data: string }[]).map(
      (row) => {
        const course = JSON.parse(row.data) as { code?: string; name?: string };
        return [row.id, [course.code, course.name].filter(Boolean).join(' ')];
      },
    ),
  );
  const rows = (
    db.prepare("SELECT data FROM canvas_sources WHERE id LIKE 'bbann:%'").all() as {
      data: string;
    }[]
  )
    .map((row) => JSON.parse(row.data) as Announcement)
    .filter((a) => a.updatedAt && Date.parse(a.updatedAt) > since)
    .sort((a, b) => Date.parse(a.updatedAt!) - Date.parse(b.updatedAt!));
  const latest = rows.at(-1)?.updatedAt ?? undefined;
  const text = rows
    .map(
      (a) =>
        `### ${names.get(a.courseId) ?? '课程'} · ${a.title} · ${formatTime(Date.parse(a.updatedAt!))}\n\n${clip(htmlToText(a.html ?? ''))}\n`,
    )
    .join('\n');
  return {
    source: 'mydundee',
    status: 'ok',
    newItems: rows.length,
    text,
    detail: null,
    cursor: latest ?? cursor ?? new Date(since).toISOString(),
  };
}

const MAX_SEEN_NOTICES = 500;
const NOTICE_RECHECK_DAYS = 30;

/** 游标是读过的通知链接（列表页日期只到天，只比日期会漏掉同一天后发的）；首次只往回看 14 天。 */
export async function readCampusWeb(cursor: string | undefined, now: number): Promise<SourceRead> {
  const seen: string[] = cursor ? (JSON.parse(cursor) as string[]) : [];
  const days = cursor ? NOTICE_RECHECK_DAYS : FIRST_LOOKBACK_DAYS;
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const { items, failedSites } = await readCampusWebSites(new Set(seen), since);
  const allFailed = items.length === 0 && failedSites.length > 0;
  return {
    source: 'campus',
    status: allFailed ? 'error' : 'ok',
    newItems: items.length,
    text: items
      .map(
        ({ site, notice, body }) =>
          `### ${site} · ${notice.title} · ${notice.date}\n\n${clip(body || '（正文未读取，只有标题）')}\n\n来源：${notice.url}\n`,
      )
      .join('\n'),
    detail: failedSites.length > 0 ? `打不开：${failedSites.join('、')}，下次重试` : null,
    cursor: JSON.stringify([...seen, ...items.map((i) => i.notice.url)].slice(-MAX_SEEN_NOTICES)),
  };
}

interface MailRow {
  id: number;
  subject: string | null;
  sender_name: string | null;
  sender_address: string | null;
  date: string | null;
  body_text: string | null;
  snippet: string | null;
}

export function readOutlook(cursor: string | undefined, now: number): SourceRead {
  const db = getDatabase();
  const account = db.prepare('SELECT 1 FROM mail_accounts LIMIT 1').get();
  if (!account)
    return {
      source: 'outlook',
      status: 'not-connected',
      newItems: 0,
      text: '',
      detail: '还没接入邮箱',
    };
  // 游标是邮件行 id；首次按日期只取最近几天。
  const rows = (
    cursor
      ? db
          .prepare(
            'SELECT id, subject, sender_name, sender_address, date, body_text, snippet FROM mail_messages WHERE id > ? AND deleted_at IS NULL ORDER BY id',
          )
          .all(Number(cursor))
      : db
          .prepare(
            'SELECT id, subject, sender_name, sender_address, date, body_text, snippet FROM mail_messages WHERE deleted_at IS NULL ORDER BY id',
          )
          .all()
  ) as MailRow[];
  const since = firstSince(now);
  const fresh = cursor ? rows : rows.filter((row) => row.date && Date.parse(row.date) > since);
  const maxId = rows.at(-1)?.id;
  const text = fresh
    .map(
      (row) =>
        `### ${row.subject ?? '（无主题）'} · ${row.sender_name ?? row.sender_address ?? '未知发件人'} · ${row.date ? formatTime(Date.parse(row.date)) : ''}\n\n${clip((row.body_text ?? row.snippet ?? '').trim())}\n`,
    )
    .join('\n');
  return {
    source: 'outlook',
    status: 'ok',
    newItems: fresh.length,
    text,
    detail: null,
    cursor: maxId !== undefined ? String(maxId) : cursor,
  };
}

export async function readQq(cursor: string | undefined, now: number): Promise<SourceRead> {
  const roots = (await defaultChatFileRoots()).filter((root) => root.app === 'qq');
  if (roots.length === 0)
    return {
      source: 'qq',
      status: 'not-connected',
      newItems: 0,
      text: '',
      detail: '本机没找到 QQ 的接收文件夹',
    };
  const since = cursor ? Date.parse(cursor) : firstSince(now);
  const files = (await listChatFiles(roots, { sinceMs: since })).filter(
    (file) => Date.parse(file.modifiedAt) > since,
  );
  const text = [...files]
    .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt))
    .map((file) => `- ${formatTime(Date.parse(file.modifiedAt))} · ${file.name}`)
    .join('\n');
  return {
    source: 'qq',
    status: 'ok',
    newItems: files.length,
    text,
    detail: null,
    cursor: new Date(now).toISOString(),
  };
}

/** 本学年在读课程（代码 + 名称），给模型判断哪些消息跟学生有关。 */
export async function currentCourses(): Promise<string[]> {
  try {
    return (await listTodoCanvasCourses()).map((course) =>
      [course.code, course.name].filter(Boolean).join(' '),
    );
  } catch {
    return [];
  }
}

/**
 * 频道 / 群聊标题里出现课程代码或课程名时，在标题后标上课程，提取时据此填 course。
 * courses 是「代码 名称」；名称太短（< 6 字符）容易误配，只按代码匹配。
 */
export function tagCourses(digest: string, courses: readonly string[]): string {
  if (courses.length === 0) return digest;
  const parsed = courses.map((course) => {
    const [code = '', ...rest] = course.split(' ');
    return { course, code: code.toLowerCase(), name: rest.join(' ').toLowerCase() };
  });
  return digest
    .split('\n')
    .map((line) => {
      if (!line.startsWith('## [')) return line;
      const lower = line.toLowerCase();
      const match = parsed.find(
        ({ code, name }) =>
          (code.length >= 4 && lower.includes(code)) || (name.length >= 6 && lower.includes(name)),
      );
      return match ? `${line}（课程：${match.course}）` : line;
    })
    .join('\n');
}
