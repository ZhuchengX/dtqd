import { describe, expect, it } from 'vitest';
import {
  csuJsxsdBase,
  csuLoginReached,
  csuTimetableUrl,
  looksLikeCsuLoginPage,
  parseCsuTimetable,
} from '../csu';
import { parseWeekNumbers } from '../api';

// 按强智 jsxsd「学期理论课表」结构手写的样例；真实页面待登录后实测核对。
const html = `
<table id="kbtable">
<tr><th>第一大节</th>
<td><div id="A1B2-1-1" class="kbcontent1" style="display:none">微积分（二）</div>
<div id="A1B2-1-1" name="kbcontent" class="kbcontent" style="display:none">微积分（二）<br/><font title='老师'>张三</font><br/><font title='周次(节次)'>1-16(周)[01-02节]</font><br/><font title='教室'>潇湘校区 A201</font><br/></div></td>
<td><div id="A1B2-2-1" name="kbcontent" class="kbcontent">英语（二）<br/><font title='老师'>Smith</font><br/><font title='周次(节次)'>2-16(双周)[01-02节]</font><br/><font title='教室'>B305</font><br/>---------------------<br/>体育<br/><font title='周次(节次)'>1-15(单周)[01-02节]</font><br/><font title='教室'>体育馆</font><br/></div></td>
<td><div id="A1B2-3-1" name="kbcontent" class="kbcontent">&nbsp;</div></td>
</tr></table>`;

describe('中南强智课表', () => {
  it('解析格子：星期、节次、周次、老师、教室，同格多门课分开', () => {
    const lessons = parseCsuTimetable(html);
    expect(lessons).toEqual([
      {
        kcmc: '微积分（二）',
        xm: '张三',
        zcd: '1-16(周)',
        jcs: '01-02',
        jc: '01-02节',
        cdmc: '潇湘校区 A201',
        xqj: '1',
      },
      {
        kcmc: '英语（二）',
        xm: 'Smith',
        zcd: '2-16(双周)',
        jcs: '01-02',
        jc: '01-02节',
        cdmc: 'B305',
        xqj: '2',
      },
      {
        kcmc: '体育',
        xm: undefined,
        zcd: '1-15(单周)',
        jcs: '01-02',
        jc: '01-02节',
        cdmc: '体育馆',
        xqj: '2',
      },
    ]);
    expect(parseWeekNumbers(lessons[1]!.zcd)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('识别登录页与登录完成地址，只放行教务服务器', () => {
    expect(looksLikeCsuLoginPage('<form action="/Logon.do?method=logon">用户登录</form>')).toBe(
      true,
    );
    expect(looksLikeCsuLoginPage(html)).toBe(false);
    expect(csuLoginReached('http://202.197.71.123/jsxsd/framework/xsMain.jsp')).toBe(true);
    expect(csuLoginReached('http://csujwc.its.csu.edu.cn/')).toBe(false);
    expect(csuJsxsdBase('http://evil.example/jsxsd/framework/xsMain.jsp')).toBeNull();
    expect(csuTimetableUrl('http://202.197.71.123/jsxsd/', '2026-2027-1')).toBe(
      'http://202.197.71.123/jsxsd/xskb/xskb_list.do?xnxq01id=2026-2027-1',
    );
  });
});
