// 中南大学强智教务（jsxsd）课表：登录后在 /jsxsd/xskb/xskb_list.do 读个人课表 HTML，
// 解析成与交大课表接口相同的原始字段（kcmc/xm/zcd/jcs/cdmc/xqj），后续入库逻辑复用。

export const CSU_LOGIN_URL = 'http://csujwc.its.csu.edu.cn/';

/** 登录后分流到的教务服务器（csujwc 首页 serversArray 所列地址）。 */
export function csuJsxsdBase(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  const allowed = host === 'csujwc.its.csu.edu.cn' || /^202\.197\.71\.\d{1,3}$/.test(host);
  if (!allowed || !parsed.pathname.startsWith('/jsxsd/')) return null;
  return `${parsed.origin}/jsxsd/`;
}

/** 登录完成的标志：进入学生主页框架（登录页本身不在 /jsxsd/framework/ 下）。 */
export function csuLoginReached(url: string): boolean {
  return csuJsxsdBase(url) !== null && /\/jsxsd\/framework\//.test(new URL(url).pathname);
}

/** DTQD 学期键 `2026-2027-1` 即强智的 xnxq01id，原样使用。 */
export function csuTimetableUrl(base: string, semester: string): string {
  return `${base}xskb/xskb_list.do?xnxq01id=${encodeURIComponent(semester)}`;
}

export interface CsuRawLesson {
  kcmc: string;
  xm?: string;
  zcd?: string;
  jcs?: string;
  jc?: string;
  cdmc?: string;
  xqj: string;
}

const decode = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');

const stripTags = (html: string) => decode(html.replace(/<[^>]+>/g, '')).trim();

function fontByTitle(chunk: string, pattern: RegExp): string | undefined {
  for (const match of chunk.matchAll(/<font[^>]*title=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/font>/gi))
    if (pattern.test(match[1]!)) return stripTags(match[2]!) || undefined;
  return undefined;
}

/** 未登录时 jsxsd 直接回登录页（HTTP 200），据此识别会话失效。 */
export function looksLikeCsuLoginPage(html: string): boolean {
  return !/kbcontent/i.test(html) && /(Logon\.do|用户登录|frmlogin)/i.test(html);
}

/**
 * 每个 `div.kbcontent` 是一个「星期 × 大节」格子，id 形如 `<hash>-<星期>-<大节>`；
 * 同格多门课用一串短横线分隔。节次优先取「周次(节次)」里的 [01-02节]。
 */
export function parseCsuTimetable(html: string): CsuRawLesson[] {
  const lessons: CsuRawLesson[] = [];
  for (const [, attributes, body] of html.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/gi)) {
    const className = attributes!.match(/class=['"]([^'"]*)['"]/i)?.[1] ?? '';
    if (!className.split(/\s+/).includes('kbcontent')) continue;
    const id = attributes!.match(/id=['"]([^'"]*)['"]/i)?.[1] ?? '';
    const weekday = Number(id.split('-').at(-2));
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    for (const chunk of body!.split(/-{5,}/)) {
      const lines = chunk
        .split(/<br\s*\/?>/i)
        .map(stripTags)
        .filter(Boolean);
      const courseName = lines[0];
      if (!courseName) continue;
      const weeksAndPeriods = fontByTitle(chunk, /周次/);
      const periods = weeksAndPeriods?.match(/\[([\d\-,，]+)节\]/)?.[1];
      lessons.push({
        kcmc: courseName,
        xm: fontByTitle(chunk, /老师|教师/),
        zcd: weeksAndPeriods?.replace(/\[[^\]]*\]/, '').trim() || undefined,
        jcs: periods,
        jc: periods ? `${periods}节` : undefined,
        cdmc: fontByTitle(chunk, /教室|地点/),
        xqj: String(weekday),
      });
    }
  }
  return lessons;
}
