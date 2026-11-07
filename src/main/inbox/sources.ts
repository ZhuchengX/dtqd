// 重要事项各来源的增量读取：每个来源只读上次以来的新内容，游标存在 workspace_settings 的 inbox-cursors。
// Teams 走隐藏窗口读 Teams 网页客户端自己的缓存；myDundee 公告与邮件读本地库；QQ 只列接收文件夹里的新文件名。
import type { InboxSource, InboxSourceStatusKind } from '../../shared/inbox';
import { listTodoCanvasCourses } from '../canvas/api';
import { defaultChatFileRoots, listChatFiles } from '../chatfiles/scan';
import { readCampusWebSites } from './campus-web';
import { getDatabase } from '../database';
import { archiveNotices } from './notice-archive';
import { syncOutlookWeb } from '../outlook-web';
import { rowsSince } from '../outlook-web/store';
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
  /** Teams 私聊内容，与 text 分开；只有发送时私聊开关开着才进入提取。 */
  privateText?: string;
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

/** 提取进度记在重要事项自己的游标里：存档同步推进了，没进入队列的内容下次还能重读。 */
export async function readTeams(
  cursor?: string,
  aiExtract = false,
  now = Date.now(),
): Promise<SourceRead> {
  if (!hasTeamsLogin())
    return {
      source: 'teams',
      status: 'not-connected',
      newItems: 0,
      text: '',
      detail: '在侧栏点 Teams 登录一次后自动同步',
    };
  const result = await syncTeams(aiExtract ? Number(cursor) || firstSince(now) : undefined);
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
  const courses = result.groupDigest || result.privateDigest ? await currentCourses() : [];
  return {
    source: 'teams',
    status,
    newItems: result.newMessages,
    text: tagCourses(result.groupDigest ?? '', courses),
    privateText: tagCourses(result.privateDigest ?? '', courses),
    detail,
    ...(result.latest !== undefined && { cursor: String(result.latest) }),
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
/** 通知的报名截止常写在后半段，比普通消息多留一些。 */
const MAX_NOTICE_CHARS = 3000;
const NOTICE_RECHECK_DAYS = 30;

/** 游标是读过的通知链接（列表页日期只到天，只比日期会漏掉同一天后发的）；首次只往回看 14 天。 */
export async function readCampusWeb(
  cursor: string | undefined,
  now: number,
  office = false,
): Promise<SourceRead> {
  const seen: string[] = cursor ? (JSON.parse(cursor) as string[]) : [];
  const days = cursor ? NOTICE_RECHECK_DAYS : FIRST_LOOKBACK_DAYS;
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const { items, failedSites, officeLoginExpired } = await readCampusWebSites(
    new Set(seen),
    since,
    office,
  );
  archiveNotices(items.map(({ site, notice, body }) => ({ ...notice, site, body })));
  const allFailed = items.length === 0 && failedSites.length > 0;
  return {
    source: 'campus',
    status: allFailed ? 'error' : 'ok',
    newItems: items.length,
    text: [...items]
      .sort((a, b) => a.notice.date.localeCompare(b.notice.date))
      .map(
        ({ site, notice, body }) =>
          `### ${site} · ${notice.title} · ${notice.date}\n\n${(body || '（正文未读取，只有标题）').slice(0, MAX_NOTICE_CHARS)}\n\n来源：${notice.url}\n`,
      )
      .join('\n'),
    detail:
      [
        officeLoginExpired ? '校内办公网登录已过期，点右侧按钮重新登录' : '',
        failedSites.length > 0 ? `打不开：${failedSites.join('、')}，下次重试` : '',
      ]
        .filter(Boolean)
        .join('；') || null,
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

/** 学校邮箱走 Outlook 网页版时：先读一遍列表，再把游标后的新邮件交给提取。 */
export async function readOutlookWeb(cursor: string | undefined): Promise<SourceRead> {
  const { status } = await syncOutlookWeb();
  if (status !== 'ok')
    return {
      source: 'outlook',
      status: status === 'needs-login' ? 'needs-login' : 'not-ready',
      newItems: 0,
      text: '',
      detail:
        status === 'needs-login'
          ? '邮箱登录已过期，到邮箱页重新连接'
          : '这次没读到收件箱，稍后重试',
    };
  const { labels, cursor: next } = rowsSince(cursor);
  return {
    source: 'outlook',
    status: 'ok',
    newItems: labels.length,
    text: labels.map((label) => `### 邮件\n\n${clip(label)}\n`).join('\n'),
    detail: null,
    cursor: next,
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
