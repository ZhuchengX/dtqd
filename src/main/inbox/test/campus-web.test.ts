import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../../teams/extract', () => ({
  htmlToText: (html: string) => html.replace(/<[^>]+>/g, ''),
}));
import { newNotices, noticeBody, parseNoticeList } from '../campus-web';

describe('parseNoticeList', () => {
  it('学院卡片式：日和年月分开写', () => {
    const html = `<li><a href="../info/1048/3287.htm" title="奖励金公示"><div class="tm">
      <span>26</span> <span class="big">2026-10</span></div><h1>奖励金公示</h1></a></li>`;
    expect(parseNoticeList(html, 'https://dii.csu.edu.cn/xwtz/zxtz.htm')).toEqual([
      { title: '奖励金公示', url: 'https://dii.csu.edu.cn/info/1048/3287.htm', date: '2026-10-26' },
    ]);
  });

  it('本科生院：链接到办公网，还原 &amp;，日期带方括号', () => {
    const html = `<LI><A href="https://oa.csu.edu.cn/con/PDFPage?YWMC=A&amp;JLNM=B">竞赛通知</A><SPAN>[2026-10-20]</SPAN></LI>`;
    expect(parseNoticeList(html, 'https://bksy.csu.edu.cn/tztg.htm')).toEqual([
      {
        title: '竞赛通知',
        url: 'https://oa.csu.edu.cn/con/PDFPage?YWMC=A&JLNM=B',
        date: '2026-10-20',
      },
    ]);
  });

  it('日期在下一条之前才算这一条的；没日期的不要，同链接只留一次', () => {
    const html = `<a href="info/1/1.htm">轮播</a><a href="info/1/2.htm">甲</a><span>2026-10-01</span>
      <a href="info/1/2.htm">甲</a><span>2026-10-01</span>`;
    const notices = parseNoticeList(html, 'https://a.csu.edu.cn/');
    expect(notices.map((n) => n.title)).toEqual(['甲']);
  });
});

describe('noticeBody', () => {
  it('取正文，没有正文返回空', () => {
    expect(noticeBody('<div class="v_news_content"><p>报名截止 11 月 5 日</p></div>')).toContain(
      '报名截止',
    );
    expect(noticeBody('<p>无</p>')).toBe('');
  });
});

describe('newNotices', () => {
  it('跳过读过的和早于起始日的', () => {
    const notice = (url: string, date: string) => ({ title: url, url, date });
    const list = [notice('a', '2026-10-30'), notice('b', '2026-10-30'), notice('c', '2026-09-01')];
    expect(newNotices(list, new Set(['a']), '2026-10-01').map((n) => n.url)).toEqual(['b']);
  });
});
