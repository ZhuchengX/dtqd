// 学校网站通知：中南大学、邓迪国际学院的公开通知栏（博达 CMS 列表页）。只读公开页面，不用登录会话；
// 办公网 oa.csu.edu.cn 的正文要统一身份认证，这里只取本科生院列表上公开的标题。
import { net } from 'electron';
import { htmlToText } from '../teams/extract';

export interface CampusWebSite {
  name: string;
  url: string;
}

export const CAMPUS_WEB_SITES: readonly CampusWebSite[] = [
  { name: '邓迪国际学院 · 最新通知', url: 'https://dii.csu.edu.cn/xwtz/zxtz.htm' },
  { name: '邓迪国际学院 · 学生工作', url: 'https://dii.csu.edu.cn/xsgz/xgdt.htm' },
  { name: '中南大学本科生院 · 通知公告', url: 'https://bksy.csu.edu.cn/tztg.htm' },
  { name: '中南大学学工网 · 资助通知', url: 'https://xgw.csu.edu.cn/zzgl/tzgg.htm' },
];

export interface CampusNotice {
  title: string;
  url: string;
  /** YYYY-MM-DD */
  date: string;
}

const NOTICE_LINK = /<a\b[^>]*?href="([^"]*(?:info\/\d+\/\d+\.htm|\/con\/PDFPage\?[^"]*))"[^>]*>/gi;
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

/** 新通知：没读过，且不早于 since（YYYY-MM-DD）。旧的不补读，免得把整年通知当成新消息。 */
export function newNotices(
  notices: readonly CampusNotice[],
  seen: ReadonlySet<string>,
  since: string,
): CampusNotice[] {
  return notices.filter((notice) => !seen.has(notice.url) && notice.date >= since);
}

async function fetchPage(url: string): Promise<string> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export interface CampusWebRead {
  items: { site: string; notice: CampusNotice; body: string }[];
  failedSites: string[];
}

/** 逐站读取；一个站点打不开不影响其他站点，它的通知下次还算新的。 */
export async function readCampusWebSites(
  seen: ReadonlySet<string>,
  since: string,
): Promise<CampusWebRead> {
  const read: CampusWebRead = { items: [], failedSites: [] };
  for (const site of CAMPUS_WEB_SITES) {
    try {
      const fresh = newNotices(parseNoticeList(await fetchPage(site.url), site.url), seen, since);
      for (const [index, notice] of fresh.entries()) {
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
