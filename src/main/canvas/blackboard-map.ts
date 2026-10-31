// Blackboard Learn（myDundee）REST 结构 → Canvas 模块的课程树与资料：纯函数，网络层见 blackboard.ts。
import type { SourceItem } from '../../shared/api';

export const BLACKBOARD_ORIGIN = 'https://my.dundee.ac.uk';
export const BLACKBOARD_API = `${BLACKBOARD_ORIGIN}/learn/api/public/v1/`;

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

/** Blackboard 主键形如 `_12345_1`：取中间数字作为本地数值 id（同一实例内唯一）。 */
export function blackboardNumericId(id: string): number {
  const match = id.match(/^_(\d+)_\d+$/);
  return match ? Number(match[1]) : 0;
}

/** 分页：`paging.nextPage` 为站内相对路径，只放行同源 public API。 */
export function blackboardNextPage(body: unknown): string | null {
  const next = str(row(row(body).paging).nextPage);
  if (!next) return null;
  const url = new URL(next, BLACKBOARD_ORIGIN);
  if (url.origin !== BLACKBOARD_ORIGIN || !url.pathname.startsWith('/learn/api/public/'))
    throw new Error('myDundee 分页地址无效');
  return url.href;
}

export interface BlackboardSource {
  id: string;
  courseId: number;
  title: string;
  kind: 'file' | 'assignment' | 'page' | 'discussion' | 'link';
  html?: string;
  url?: string;
  /** 文件下载地址（Blackboard 站内，需登录会话）。 */
  downloadUrl?: string;
  mime?: string;
  size?: number;
  dueAt?: string | null;
  updatedAt?: string | null;
}

export type ContentKind = 'folder' | 'file' | 'document' | 'link' | 'assignment' | 'other';

export function contentKind(content: Row): ContentKind {
  const handler = str(row(content.contentHandler).id);
  if (handler === 'resource/x-bb-folder' || handler === 'resource/x-bb-lesson') return 'folder';
  if (handler === 'resource/x-bb-file') return 'file';
  if (handler === 'resource/x-bb-document') return 'document';
  if (handler === 'resource/x-bb-externallink') return 'link';
  if (/asmt|assignment|test-link/.test(handler)) return 'assignment';
  return content.hasChildren === true ? 'folder' : 'other';
}

/** x-bb-document 的附件 API 不可用，文件以 bbcswebdav 链接嵌在正文里。 */
export function embeddedFiles(html: string): { url: string; name: string }[] {
  const files = new Map<string, string>();
  for (const match of html.matchAll(
    /(?:href|src|data-bbfile)=["']([^"']*bbcswebdav[^"']*)["']/gi,
  )) {
    let url: URL;
    try {
      url = new URL(match[1]!.replaceAll('&amp;', '&'), BLACKBOARD_ORIGIN);
    } catch {
      continue;
    }
    if (url.origin !== BLACKBOARD_ORIGIN) continue;
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
    if (name && !files.has(url.href)) files.set(url.href, name);
  }
  return [...files].map(([url, name]) => ({ url, name }));
}

/** 课程内容页（Ultra）在浏览器中的地址，供「在网页中打开」。 */
export function courseOutlineUrl(courseBbId: string): string {
  return `${BLACKBOARD_ORIGIN}/ultra/courses/${encodeURIComponent(courseBbId)}/outline`;
}

export interface ContentNode {
  content: Row;
  parentId: string;
  attachments: Row[];
}

/** 把一层内容节点映射为树条目与资料；文件夹节点返回其条目 id 供调用方递归。 */
export function mapContent(
  courseId: number,
  courseBbId: string,
  node: ContentNode,
  dueByContent: ReadonlyMap<string, string>,
  items: SourceItem[],
  sources: Map<string, BlackboardSource>,
): string | null {
  const { content, parentId } = node;
  const contentId = str(content.id);
  const title = str(content.title) || '未命名内容';
  const kind = contentKind(content);
  const updatedAt = str(content.modified) || str(content.created) || null;
  const nodeId = `bb:${contentId}`;
  const html = str(content.body);
  const addFile = (fileParent: string, key: string, file: BlackboardSource) => {
    sources.set(file.id, file);
    items.push({
      id: `${fileParent}/${key}`,
      parentId: fileParent,
      courseId,
      name: file.title,
      kind: 'file',
      sourceId: file.id,
    });
  };
  if (kind === 'folder') {
    items.push({ id: nodeId, parentId, courseId, name: title, kind: 'folder', sourceId: null });
    return nodeId;
  }
  if (kind === 'file') {
    for (const attachment of node.attachments) {
      const attachmentId = str(attachment.id);
      if (!attachmentId) continue;
      addFile(parentId, `bbfile:${attachmentId}`, {
        id: `bbfile:${courseBbId}:${contentId}:${attachmentId}`,
        courseId,
        title: str(attachment.fileName) || title,
        kind: 'file',
        mime: str(attachment.mimeType),
        downloadUrl: `${BLACKBOARD_API}courses/${courseBbId}/contents/${contentId}/attachments/${attachmentId}/download`,
        updatedAt,
      });
    }
    return null;
  }
  const sourceId = `bb:${courseBbId}:${contentId}`;
  const dueAt = dueByContent.get(contentId) ?? null;
  const itemKind: SourceItem['kind'] =
    kind === 'link' ? 'link' : kind === 'assignment' ? 'assignment' : 'page';
  sources.set(sourceId, {
    id: sourceId,
    courseId,
    title,
    kind: itemKind === 'link' ? 'link' : itemKind === 'assignment' ? 'assignment' : 'page',
    html: kind === 'link' ? undefined : html,
    url: kind === 'link' ? str(row(content.contentHandler).url) : courseOutlineUrl(courseBbId),
    dueAt,
    updatedAt,
  });
  items.push({ id: nodeId, parentId, courseId, name: title, kind: itemKind, sourceId, dueAt });
  for (const file of embeddedFiles(html))
    addFile(nodeId, `bbembed:${file.url}`, {
      id: `bbembed:${courseBbId}:${file.url}`,
      courseId,
      title: file.name,
      kind: 'file',
      downloadUrl: file.url,
      updatedAt,
    });
  return null;
}

/** 成绩列 → 作业：有截止时间的列才算作业；contentId 用于把截止时间挂回内容树。 */
export function gradeColumnAssignments(columns: Row[]): {
  dueByContent: Map<string, string>;
  assignments: {
    id: string;
    name: string;
    dueAt: string;
    contentId: string;
    description: string;
  }[];
} {
  const dueByContent = new Map<string, string>();
  const assignments = [];
  for (const column of columns) {
    const dueAt = str(row(column.grading).due);
    if (!dueAt) continue;
    const contentId = str(column.contentId);
    if (contentId) dueByContent.set(contentId, dueAt);
    assignments.push({
      id: str(column.id),
      name: str(column.name) || '未命名作业',
      dueAt,
      contentId,
      description: str(column.description),
    });
  }
  return { dueByContent, assignments };
}

/** Blackboard 成绩状态 → Canvas 风格 submission，供 TODO 复用 canvasTodoStatus。 */
export function blackboardSubmission(grade: Row | undefined): Row | undefined {
  if (!grade) return undefined;
  const status = str(grade.status);
  const graded = status === 'Graded' || grade.score !== undefined;
  const submitted = graded || status === 'NeedsGrading';
  return {
    workflow_state: graded ? 'graded' : submitted ? 'submitted' : 'unsubmitted',
    submitted_at: submitted ? str(grade.modified) || str(grade.created) || true : null,
  };
}

/** 学期名：优先 terms 接口的 name，其次课程名里的学年（如 2025/26、2025-26）。 */
export function blackboardTerm(termName: string, course: Row): string {
  const text = `${str(course.name)} ${str(course.courseId)}`;
  // DIICSU 模块名带「( SEM 1 25/26 )」，换成与中南课表一致的学期键 2025-2026-1。
  const semester = text.match(/SEM\s*([12])(?:\s*-\s*([12]))?\s+(\d{2})\/(\d{2})/i);
  if (semester) {
    const year = `20${semester[3]}-20${semester[4]}`;
    return semester[2] ? `${year} 全学年` : `${year}-${semester[1]}`;
  }
  const match = `${termName} ${text}`.match(/(20\d{2})\s*[/-]\s*(\d{2,4})/);
  if (!match) return termName || '未标注学期';
  const end = match[2]!.length === 2 ? `20${match[2]}` : match[2]!;
  return `${match[1]}-${end} 学年`;
}
