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

/** 教学周历（我的桌面）地址：POST xnxq01id 取任一学期。 */
export function csuCalendarUrl(base: string): string {
  return `${base}jxzl/jxzl_query`;
}

/**
 * 教学周历每格 title 为「2026年09月07」，首行即第 1 周（周日起排）。
 * 取前 7 格中的周一作为开学日期，找不到返回 null。
 */
export function parseCsuSemesterStart(html: string): string | null {
  const dates = [...html.matchAll(/title=['"](\d{4})年(\d{2})月(\d{2})/g)].slice(0, 7);
  for (const [, year, month, day] of dates) {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCDay() === 1) return `${year}-${month}-${day}`;
  }
  return null;
}

/** DTQD 学期键 `2026-2027-1` 即强智的 xnxq01id，原样使用。 */
export function csuTimetableUrl(base: string, semester: string): string {
  return `${base}xskb/xskb_list.do?xnxq01id=${encodeURIComponent(semester)}`;
}

/** 课表页学期下拉（select#xnxq01id）列出的学期，新到旧排列。 */
export function parseCsuSemesters(html: string): string[] {
  const found = new Set<string>();
  for (const [, value] of html.matchAll(/<option[^>]*value=['"](\d{4}-\d{4}-[123])['"]/gi))
    found.add(value!);
  return [...found].sort().reverse();
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

export const stripTags = (html: string) => decode(html.replace(/<[^>]+>/g, '')).trim();

function fontByTitle(chunk: string, pattern: RegExp): string | undefined {
  for (const match of chunk.matchAll(/<font[^>]*title=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/font>/gi))
    if (pattern.test(match[1]!)) return stripTags(match[2]!) || undefined;
  return undefined;
}

/** 未登录时 jsxsd 直接回登录页（HTTP 200），据此识别会话失效。 */
export function looksLikeCsuLoginPage(html: string): boolean {
  return !/kbcontent/i.test(html) && /(Logon\.do|用户登录|frmlogin)/i.test(html);
}

/** 行首「1－2」即该大节的小节范围；没有数字时按第 k 个大节推成 2k-1～2k 节。 */
function rowPeriods(row: string, index: number): string {
  const header = stripTags(row.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '');
  const range = header.match(/(\d+)\D+(\d+)/);
  return range ? `${range[1]}-${range[2]}` : `${index * 2 + 1}-${index * 2 + 2}`;
}

/**
 * 课表每行一个大节，行内每个 `div.kbcontent` 是一个星期格子，id 形如 `<行哈希>-<星期>-<1|2>`；
 * 同格多门课用一串短横线分隔。节次优先取「周次(节次)」里的 [01-02节]，否则用行首范围。
 */
export function parseCsuTimetable(html: string): CsuRawLesson[] {
  const lessons: CsuRawLesson[] = [];
  let rowIndex = 0;
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!/kbcontent/i.test(row!)) continue;
    const fallbackPeriods = rowPeriods(row!, rowIndex++);
    for (const [, attributes, body] of row!.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/gi)) {
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
        const periods = weeksAndPeriods?.match(/\[([\d\-,，]+)节\]/)?.[1] ?? fallbackPeriods;
        lessons.push({
          kcmc: courseName,
          xm: fontByTitle(chunk, /老师|教师/),
          zcd: weeksAndPeriods?.replace(/\[[^\]]*\]/, '').trim() || undefined,
          jcs: periods,
          jc: `${periods}节`,
          cdmc: fontByTitle(chunk, /教室|地点/),
          xqj: String(weekday),
        });
      }
    }
  }
  return lessons;
}
