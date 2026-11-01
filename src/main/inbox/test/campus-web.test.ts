import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../../campus', () => ({ getCampusSession: vi.fn() }));
vi.mock('../../teams/extract', () => ({
  htmlToText: (html: string) => html.replace(/<[^>]+>/g, ''),
}));
import { newNotices, noticeBody, parseNoticeList, parseOfficeNotices } from '../campus-web';

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

describe('就业信息网', () => {
  it('招聘公告链接和 span 里的日期', () => {
    const html = `<a href="/campus/view/id/573694" class="title"><font>招聘汇总</font></a><span class="time">2026-10-31</span>`;
    expect(parseNoticeList(html, 'https://career.csu.edu.cn/')).toEqual([
      {
        title: '招聘汇总',
        url: 'https://career.csu.edu.cn/campus/view/id/573694',
        date: '2026-10-31',
      },
    ]);
  });
});

describe('parseOfficeNotices', () => {
  it('带部门名，链接与本科生院列表一致，缺字段的跳过', () => {
    const json = JSON.stringify({
      data: [
        { WJBT: '运动会通知', DJSJ: '2026-10-23', QCBMMC: '体育教研部', YWMC: 'GGTZ', JLNM: 'A1' },
        { WJBT: '坏行', DJSJ: '2026-10-23' },
      ],
    });
    expect(parseOfficeNotices(json)).toEqual([
      {
        title: '【体育教研部】运动会通知',
        url: 'https://oa.csu.edu.cn/con/PDFPage?YWMC=GGTZ&JLNM=A1',
        date: '2026-10-23',
      },
    ]);
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
