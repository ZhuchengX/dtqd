// 学校网站通知：中南大学、邓迪国际学院的公开通知栏（博达 CMS 列表页），加上登录后的校内办公网通知列表。
// 办公网只调用列表查询和正文 PDF 接口，不碰点击计数和置顶接口。
import { net } from 'electron';
import { getCampusSession } from '../campus';
import { htmlToText } from '../teams/extract';
import { officePdfUrl, officeTitleWorthReading, pdfText } from './notice-pdf';

export const CAMPUS_OFFICE_URL = 'https://oa.csu.edu.cn/con/ggtz';

export interface CampusWebSite {
  name: string;
  url: string;
}

export const CAMPUS_WEB_SITES: readonly CampusWebSite[] = [
  { name: '邓迪国际学院 · 最新通知', url: 'https://dii.csu.edu.cn/xwtz/zxtz.htm' },
  { name: '邓迪国际学院 · 新闻动态', url: 'https://dii.csu.edu.cn/xwtz/xwdt.htm' },
  { name: '邓迪国际学院 · 学生工作', url: 'https://dii.csu.edu.cn/xsgz/xgdt.htm' },
  { name: '邓迪国际学院 · 国际交流', url: 'https://dii.csu.edu.cn/xsgz/lxzx.htm' },
  { name: '中南大学本科生院 · 通知公告', url: 'https://bksy.csu.edu.cn/tztg.htm' },
  { name: '中南大学学工网', url: 'https://xgw.csu.edu.cn/' },
  { name: '中南大学学工网 · 资助通知', url: 'https://xgw.csu.edu.cn/zzgl/tzgg.htm' },
  { name: '中南大学国际合作与交流处 · 公告', url: 'https://iecd.csu.edu.cn/xwzx/ggtz.htm' },
  { name: '中南大学就业信息网', url: 'https://career.csu.edu.cn/' },
  { name: '中南大学研究生院', url: 'https://gra.csu.edu.cn/' },
  { name: '中南大学图书馆', url: 'https://lib.csu.edu.cn/' },
  { name: '中南大学后勤保障部 · 通知', url: 'https://hqbzb.csu.edu.cn/zhxx/tzgg.htm' },
];

export interface CampusNotice {
  title: string;
  url: string;
  /** YYYY-MM-DD */
  date: string;
}

const NOTICE_LINK =
  /<a\b[^>]*?href="([^"]*(?:info\/\d+\/\d+\.htm|\/con\/PDFPage\?[^"]*|\/(?:news|campus)\/view\/[^"]*))"[^>]*>/gi;
const OFFICE_LIST_URL = 'https://oa.csu.edu.cn/con/xnbg/contentList';
const OFFICE_PAGE_ROWS = 100;
const MAX_OFFICE_BODIES = 20;
const MAX_DETAILS_PER_SITE = 10;
const MAX_BODY_HTML = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

function noticeDate(block: string): string | null {
  const full = block.match(/(20\d\d)[-.](\d{2})[-.](\d{2})/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  const split = block.match(/>\s*(\d{1,2})\s*<\/span>\s*<span[^>]*>\s*(20\d\d)-(\d{2})\s*</i);
  return split ? `${split[2]}-${split[3]}-${split[1]!.padStart(2, '0')}` : null;
}

/** 从列表页取通知：每条的标题和日期都在这条链接到下一条链接之间；没有日期的（导航、轮播）不算。 */
export function parseNoticeList(html: string, pageUrl: string): CampusNotice[] {
  const links = [...html.matchAll(NOTICE_LINK)];
  const notices = new Map<string, CampusNotice>();
  links.forEach((link, index) => {
    const block = html.slice(link.index, links[index + 1]?.index ?? link.index + 1500);
    const date = noticeDate(block);
    const title =
      link[0].match(/title="([^"]+)"/)?.[1] ??
      htmlToText(block.match(/<a\b[^>]*>(.*?)<\/a>/is)?.[1] ?? '').trim();
    const url = new URL(link[1]!.replaceAll('&amp;', '&'), pageUrl).href;
    if (date && title && !notices.has(url)) notices.set(url, { title, url, date });
  });
  return [...notices.values()];
}

/** 详情页正文在 v_news_content 里；找不到（附件型通知、办公网）就只有标题。 */
export function noticeBody(html: string): string {
  const start = html.indexOf('v_news_content');
  if (start < 0) return '';
  const open = html.indexOf('>', start);
  return htmlToText(html.slice(open + 1, open + 1 + MAX_BODY_HTML)).trim();
}

/** 就业信息网的文章列表：日期在链接前面（通用解析会错配到下一行），单独解析。 */
export function parseCareerNews(html: string, pageUrl: string): CampusNotice[] {
  const rows = html.matchAll(
    /<li class="span2 y">\s*(20\d\d-\d{2}-\d{2})\s*<\/li>\s*<li class="span1">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis,
  );
  return [...rows].map(([, date, href, title]) => ({
    title: htmlToText(title!).trim(),
    url: new URL(href!, pageUrl).href,
    date: date!,
  }));
}

/** 研招网列表：日、年月写在链接前面，也要单独解析。 */
export function parseAdmissionsNews(html: string, pageUrl: string): CampusNotice[] {
  const rows = html.matchAll(
    /class="date_day">\s*(\d{1,2})\s*<\/div>\s*<div class="date_yearly">\s*(20\d\d)\s*\/\s*(\d{2})\s*<\/div>.*?<a\b[^>]*href="([^"]+)"[^>]*title="([^"]+)"/gis,
  );
  return [...rows].map(([, day, year, month, href, title]) => ({
    title: title!,
    url: new URL(href!, pageUrl).href,
    date: `${year}-${month}-${day!.padStart(2, '0')}`,
  }));
}

/** 就业信息网详情页没有 v_news_content：从标题往后取文字。 */
export function careerBody(html: string): string {
  const start = html.search(/class="aTitle"|<h1\b/);
  return start < 0 ? '' : htmlToText(html.slice(start, start + MAX_BODY_HTML)).trim();
}

/** 博达 CMS 列表页的「下页」链接；到最后一页时没有。 */
export function nextPageUrl(html: string, pageUrl: string): string | null {
  const href = html.match(/<a\b[^>]*href="([^"]+\.htm)"[^>]*>\s*下页/)?.[1];
  return href ? new URL(href, pageUrl).href : null;
}

/** 新通知：没读过，且不早于 since（YYYY-MM-DD）。旧的不补读，免得把整年通知当成新消息。 */
export function newNotices(
  notices: readonly CampusNotice[],
  seen: ReadonlySet<string>,
  since: string,
): CampusNotice[] {
  return notices.filter((notice) => !seen.has(notice.url) && notice.date >= since);
}

export async function fetchPage(url: string): Promise<string> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** 办公网列表一行转成通知；链接和本科生院列表上的同一份通知相同，读过一次就不会重复。 */
export function parseOfficeNotices(json: string): CampusNotice[] {
  const rows = (JSON.parse(json) as { data?: Record<string, unknown>[] }).data ?? [];
  return rows.flatMap((row) => {
    const { WJBT: title, DJSJ: date, QCBMMC: department, YWMC: type, JLNM: id } = row;
    if (typeof title !== 'string' || typeof date !== 'string' || !type || !id) return [];
    const query = new URLSearchParams({ YWMC: String(type), JLNM: String(id) });
    return [
      {
        title: department ? `【${String(department)}】${title}` : title,
        url: `https://oa.csu.edu.cn/con/PDFPage?${query}`,
        date: date.slice(0, 10),
      },
    ];
  });
}

/** 登录过期时办公网把请求转到统一身份认证页，返回的不是 JSON，这里返回 null。 */
export async function fetchOfficeNotices(): Promise<CampusNotice[] | null> {
  const campus = await getCampusSession();
  const response = await campus.fetch(OFFICE_LIST_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      params: JSON.stringify({ tableName: 'ZNDX_ZHBG_GGTZ', tjnr: '' }),
      pageSize: '1',
      pageNo: String(OFFICE_PAGE_ROWS),
    }).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.trimStart().startsWith('{') ? parseOfficeNotices(text) : null;
}

/** 读不到正文（登录刚过期、扫描版）就只留标题，不影响这一轮。 */
export async function officeBody(noticeUrl: string): Promise<string> {
  const pdf = officePdfUrl(noticeUrl);
  if (!pdf) return '';
  try {
    const campus = await getCampusSession();
    const response = await campus.fetch(pdf, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const data = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || new TextDecoder('latin1').decode(data.subarray(0, 5)) !== '%PDF-')
      return '';
    return await pdfText(data);
  } catch (error) {
    console.error('[inbox] 办公网正文读取失败', error instanceof Error ? error.message : '');
    return '';
  }
}

export interface CampusWebRead {
  items: { site: string; notice: CampusNotice; body: string }[];
  failedSites: string[];
  officeLoginExpired: boolean;
}

/** 逐站读取；一个站点打不开不影响其他站点，它的通知下次还算新的。 */
export async function readCampusWebSites(
  seen: ReadonlySet<string>,
  since: string,
  office = false,
): Promise<CampusWebRead> {
  const read: CampusWebRead = { items: [], failedSites: [], officeLoginExpired: false };
  const known = new Set(seen);
  try {
    const notices = office ? await fetchOfficeNotices() : [];
    if (notices === null) read.officeLoginExpired = true;
    let bodies = 0;
    let chars = 0;
    let cjk = 0;
    for (const notice of newNotices(notices ?? [], known, since)) {
      known.add(notice.url);
      const readBody = bodies < MAX_OFFICE_BODIES && officeTitleWorthReading(notice.title);
      if (readBody) bodies += 1;
      const body = readBody ? await officeBody(notice.url) : '';
      chars += body.length;
      cjk += body.match(/\p{Script=Han}/gu)?.length ?? 0;
      read.items.push({ site: '中南大学校内办公网', notice, body });
    }
    if (bodies > 0) console.log('[inbox] 办公网正文', bodies, '份', chars, '字，其中汉字', cjk);
  } catch (error) {
    console.error('[inbox] 校内办公网读取失败', error instanceof Error ? error.message : '');
    read.failedSites.push('校内办公网');
  }
  for (const site of CAMPUS_WEB_SITES) {
    try {
      const fresh = newNotices(parseNoticeList(await fetchPage(site.url), site.url), known, since);
      for (const [index, notice] of fresh.entries()) {
        known.add(notice.url);
        const readable = index < MAX_DETAILS_PER_SITE && !notice.url.includes('/con/PDFPage');
        const body = readable ? noticeBody(await fetchPage(notice.url).catch(() => '')) : '';
        read.items.push({ site: site.name, notice, body });
      }
    } catch (error) {
      console.error(
        '[inbox] 学校网站读取失败',
        site.url,
        error instanceof Error ? error.message : '',
      );
      read.failedSites.push(site.name);
    }
  }
  return read;
}
