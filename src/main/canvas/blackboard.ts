// myDundee（Blackboard Learn Ultra）接入：学生在校园分区登录窗内自行完成 Microsoft SSO，
// 之后用该会话直接调用 public REST API；令牌与 Cookie 不离开 Chromium 会话。
import { net, type WebContents } from 'electron';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { getCampusSession, openCampusLoginWindow, CampusAuthError } from '../campus';
import { getDatabase } from '../database';
import { importDundeeCookies } from './chrome-cookies';
import type { CanvasCourse, SourceItem } from '../../shared/api';
import {
  BLACKBOARD_API,
  BLACKBOARD_ORIGIN,
  blackboardNextPage,
  blackboardNumericId,
  blackboardSubmission,
  blackboardTerm,
  contentKind,
  courseOutlineUrl,
  gradeColumnAssignments,
  mapContent,
  type BlackboardSource,
} from './blackboard-map';

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

const PROVIDER_KEY = 'lms-provider';
const USER_KEY = 'blackboard-user';
const LOGIN_ERROR = 'myDundee 登录已失效，请重新登录';
const MAX_CONTENT_DEPTH = 6;

export function blackboardConnected(): boolean {
  const value = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(PROVIDER_KEY) as { value: string } | undefined;
  return value?.value === 'blackboard';
}

export function blackboardUser(): string | null {
  const value = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(USER_KEY) as { value: string } | undefined;
  return value?.value ?? null;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`myDundee 接口返回 ${status}`);
  }
}

async function requestOnce(url: string): Promise<unknown> {
  const campus = await getCampusSession();
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      session: campus,
      useSessionCookies: true,
      redirect: 'manual',
    });
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('myDundee 请求超时，请稍后重试'));
    }, 30000);
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    request.setHeader('Accept', 'application/json');
    request.on('error', () => fail(new Error('无法连接 myDundee，请检查网络')));
    request.on('redirect', () => {
      request.abort();
      fail(new CampusAuthError(LOGIN_ERROR));
    });
    request.on('response', (response) => {
      const status = response.statusCode;
      if (status === 401 || status === 403) {
        fail(status === 401 ? new CampusAuthError(LOGIN_ERROR) : new HttpStatusError(status));
        return;
      }
      if (status !== 200) {
        fail(new HttpStatusError(status));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', () => fail(new Error('myDundee 响应中断，请稍后重试')));
      response.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('myDundee 返回了无法解析的内容'));
        }
      });
    });
    request.end();
  });
}

// 429 为平台限流：退避重试；其余错误直接上抛。
async function request(path: string): Promise<unknown> {
  const url = new URL(path, BLACKBOARD_API);
  if (url.origin !== BLACKBOARD_ORIGIN || !url.pathname.startsWith('/learn/api/public/'))
    throw new Error('myDundee 地址无效');
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(url.href);
    } catch (error) {
      if (!(error instanceof HttpStatusError) || error.status !== 429 || attempt >= 4) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}

async function list(path: string): Promise<Row[]> {
  let next: string | null = new URL(path, BLACKBOARD_API).href;
  const visited = new Set<string>();
  const result: Row[] = [];
  while (next) {
    if (visited.has(next)) throw new Error('myDundee 返回了重复分页');
    visited.add(next);
    const body = await request(next);
    const results = row(body).results;
    if (Array.isArray(results)) result.push(...results.map(row));
    next = blackboardNextPage(body);
  }
  return result;
}

/** 功能未开放（404）或无权限（403）的分支视为空，不阻断课程同步。 */
async function optionalList(path: string): Promise<Row[]> {
  try {
    return await list(path);
  } catch (error) {
    if (error instanceof HttpStatusError && (error.status === 404 || error.status === 403))
      return [];
    throw error;
  }
}

async function currentUser(): Promise<Row> {
  return row(await request('users/me'));
}

export async function loginBlackboard(sender: WebContents): Promise<void> {
  const result = await openCampusLoginWindow({
    sender,
    title: '登录 myDundee',
    url: `${BLACKBOARD_ORIGIN}/ultra/course`,
    reached: (url) => {
      // 跳转途中窗口地址可能短暂为空，不能直接 new URL。
      if (!URL.canParse(url)) return false;
      const parsed = new URL(url);
      return parsed.origin === BLACKBOARD_ORIGIN && parsed.pathname.startsWith('/ultra');
    },
    probe: async () => {
      await currentUser();
    },
    retryProbe: true,
  });
  if (!result.ok) throw new Error(result.error);
  await saveBlackboardLogin();
}

/** 仅 macOS：把 Chrome / Edge 里已登录的 myDundee 会话导入校园分区，返回来源浏览器名。 */
export async function importBlackboardFromBrowser(): Promise<string> {
  const browser = await importDundeeCookies(await getCampusSession(), async () => {
    await currentUser();
  });
  await saveBlackboardLogin();
  return browser;
}

async function saveBlackboardLogin(): Promise<void> {
  const user = await currentUser();
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      PROVIDER_KEY,
      'blackboard',
    );
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      USER_KEY,
      str(user.id),
    );
  })();
}

export async function disconnectBlackboard(): Promise<void> {
  getDatabase()
    .prepare('DELETE FROM workspace_settings WHERE key IN (?, ?)')
    .run(PROVIDER_KEY, USER_KEY);
  const campus = await getCampusSession();
  for (const cookie of await campus.cookies.get({})) {
    const domain = cookie.domain?.replace(/^\./, '') ?? '';
    if (domain === 'dundee.ac.uk' || domain.endsWith('.dundee.ac.uk'))
      await campus.cookies.remove(`https://${domain}${cookie.path || '/'}`, cookie.name);
  }
}

const termNames = new Map<string, string>();
async function termName(termId: string): Promise<string> {
  if (!termId) return '';
  const cached = termNames.get(termId);
  if (cached !== undefined) return cached;
  let name = '';
  try {
    name = str(row(await request(`terms/${termId}`)).name);
  } catch (error) {
    if (!(error instanceof HttpStatusError)) throw error;
  }
  termNames.set(termId, name);
  return name;
}

export interface BlackboardCourse extends CanvasCourse {
  externalId: string;
}

export async function listBlackboardCourses(): Promise<BlackboardCourse[]> {
  const userId = blackboardUser() || str((await currentUser()).id);
  const memberships = await list(`users/${userId}/courses?expand=course&limit=100`);
  const courses: BlackboardCourse[] = [];
  for (const membership of memberships) {
    const course = row(membership.course);
    const externalId = str(course.id) || str(membership.courseId);
    const id = blackboardNumericId(externalId);
    if (!id) continue;
    courses.push({
      id,
      externalId,
      name: str(course.name) || str(course.courseId) || `课程 ${id}`,
      term: blackboardTerm(await termName(str(course.termId)), course),
      code: str(course.courseId),
      syncedAt: null,
      error: null,
    });
  }
  return courses;
}

export interface BlackboardCourseTree {
  items: SourceItem[];
  sources: BlackboardSource[];
  errors: string[];
}

export async function syncBlackboardCourseTree(
  courseId: number,
  courseBbId: string,
): Promise<BlackboardCourseTree> {
  const items: SourceItem[] = [];
  const sources = new Map<string, BlackboardSource>();
  const errors: string[] = [];
  const group = (key: string, name: string) => {
    const id = `${courseId}:${key}`;
    items.push({ id, parentId: null, courseId, name, kind: 'folder', sourceId: null });
    return id;
  };
  let columns: Row[] = [];
  try {
    columns = await optionalList(`courses/${courseBbId}/gradebook/columns?limit=100`);
  } catch (error) {
    errors.push(`作业：${error instanceof Error ? error.message : '同步失败'}`);
  }
  const { dueByContent, assignments } = gradeColumnAssignments(columns);
  try {
    const rootId = group('files', '课程内容');
    const walk = async (path: string, parentId: string, depth: number) => {
      for (const content of await optionalList(path)) {
        const kind = contentKind(content);
        const attachments =
          kind === 'file'
            ? await optionalList(`courses/${courseBbId}/contents/${str(content.id)}/attachments`)
            : [];
        const folderId = mapContent(
          courseId,
          courseBbId,
          { content, parentId, attachments },
          dueByContent,
          items,
          sources,
        );
        if (folderId && depth < MAX_CONTENT_DEPTH)
          await walk(
            `courses/${courseBbId}/contents/${str(content.id)}/children?limit=200`,
            folderId,
            depth + 1,
          );
      }
    };
    await walk(`courses/${courseBbId}/contents?limit=200`, rootId, 0);
  } catch (error) {
    if (error instanceof CampusAuthError) throw error;
    errors.push(`课程内容：${error instanceof Error ? error.message : '同步失败'}`);
  }
  if (assignments.length) {
    const rootId = group('assignments', '作业与截止');
    for (const assignment of assignments) {
      const sourceId = `bbcol:${courseBbId}:${assignment.id}`;
      sources.set(sourceId, {
        id: sourceId,
        courseId,
        title: assignment.name,
        kind: 'assignment',
        html: assignment.description,
        url: `${BLACKBOARD_ORIGIN}/ultra/courses/${encodeURIComponent(courseBbId)}/grades`,
        dueAt: assignment.dueAt,
      });
      items.push({
        id: sourceId,
        parentId: rootId,
        courseId,
        name: assignment.name,
        kind: 'assignment',
        sourceId,
        dueAt: assignment.dueAt,
      });
    }
  }
  try {
    const announcements = await optionalList(`courses/${courseBbId}/announcements?limit=100`);
    if (announcements.length) {
      const rootId = group('discussions', '课程公告');
      for (const announcement of announcements) {
        const sourceId = `bbann:${courseBbId}:${str(announcement.id)}`;
        sources.set(sourceId, {
          id: sourceId,
          courseId,
          title: str(announcement.title) || '课程公告',
          kind: 'discussion',
          html: str(announcement.body),
          url: courseOutlineUrl(courseBbId),
          updatedAt: str(announcement.modified) || str(announcement.created) || null,
        });
        items.push({
          id: sourceId,
          parentId: rootId,
          courseId,
          name: str(announcement.title) || '课程公告',
          kind: 'discussion',
          sourceId,
        });
      }
    }
  } catch (error) {
    if (error instanceof CampusAuthError) throw error;
    errors.push(`课程公告：${error instanceof Error ? error.message : '同步失败'}`);
  }
  return { items, sources: [...sources.values()], errors };
}

/** TODO 用：成绩列作业 + 本人成绩状态，整理成 Canvas 作业行的形状。 */
export async function listBlackboardTodoAssignments(courseBbId: string): Promise<Row[]> {
  const columns = await optionalList(`courses/${courseBbId}/gradebook/columns?limit=100`);
  const { assignments } = gradeColumnAssignments(columns);
  if (!assignments.length) return [];
  const userId = blackboardUser();
  const grades = new Map<string, Row>();
  if (userId)
    for (const grade of await optionalList(
      `courses/${courseBbId}/gradebook/users/${userId}?limit=200`,
    ))
      grades.set(str(grade.columnId), grade);
  return assignments.map((assignment) => ({
    id: blackboardNumericId(assignment.id),
    name: assignment.name,
    due_at: assignment.dueAt,
    description: assignment.description,
    html_url: `${BLACKBOARD_ORIGIN}/ultra/courses/${encodeURIComponent(courseBbId)}/grades`,
    published: true,
    submission: blackboardSubmission(grades.get(assignment.id)),
  }));
}

const DOWNLOAD_HOSTS =
  /(^|\.)dundee\.ac\.uk$|(^|\.)blackboard\.com$|(^|\.)blackboardcdn\.com$|(^|\.)cloudfront\.net$|(^|\.)amazonaws\.com$/;

/** 下载站内文件：允许跳转到 Blackboard 的文件存储（签名地址），其余跳转一律拒绝。 */
export async function downloadBlackboardFile(
  url: string,
  target: string,
): Promise<{ mime: string; size: number }> {
  const start = new URL(url);
  if (start.origin !== BLACKBOARD_ORIGIN) throw new Error('myDundee 下载地址无效');
  const campus = await getCampusSession();
  for (let attempt = 0; ; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const request = net.request({
          url: start.href,
          session: campus,
          useSessionCookies: true,
          redirect: 'manual',
        });
        const timer = setTimeout(() => {
          request.abort();
          reject(new Error('文件下载超时，请重试'));
        }, 180000);
        const fail = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };
        request.on('error', () => fail(new Error('无法连接 myDundee，请检查网络')));
        request.on('redirect', (_status, _method, location) => {
          const next = new URL(location, start);
          if (next.protocol !== 'https:' || !DOWNLOAD_HOSTS.test(next.hostname)) {
            request.abort();
            fail(new Error('myDundee 下载跳转地址无效'));
            return;
          }
          if (
            next.origin === BLACKBOARD_ORIGIN &&
            /\/(?:webapps\/login|auth-saml|ultra\/?$)/.test(next.pathname)
          ) {
            request.abort();
            fail(new CampusAuthError(LOGIN_ERROR));
            return;
          }
          request.followRedirect();
        });
        request.on('response', (response) => {
          const status = response.statusCode;
          if (status !== 200) {
            fail(status === 401 ? new CampusAuthError(LOGIN_ERROR) : new HttpStatusError(status));
            return;
          }
          const header = response.headers['content-type'];
          const mime = (Array.isArray(header) ? header[0] : header)?.split(';')[0] ?? '';
          if (mime === 'text/html') {
            fail(new CampusAuthError(LOGIN_ERROR));
            return;
          }
          const file = createWriteStream(target, { flags: 'wx' });
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            file.write(chunk);
          });
          response.on('error', () => {
            file.destroy();
            fail(new Error('文件下载中断，请重试'));
          });
          response.on('end', () =>
            file.end(() => {
              clearTimeout(timer);
              resolve({ mime, size });
            }),
          );
        });
        request.end();
      });
    } catch (error) {
      await rm(target, { force: true });
      if (!(error instanceof HttpStatusError) || error.status !== 429 || attempt >= 4) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}
