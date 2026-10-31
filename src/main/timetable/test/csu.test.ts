import { describe, expect, it } from 'vitest';
import {
  csuJsxsdBase,
  csuLoginReached,
  csuTimetableUrl,
  looksLikeCsuLoginPage,
  parseCsuSemesterStart,
  parseCsuSemesters,
  parseCsuTimetable,
} from '../csu';
import { currentSemester, parseWeekNumbers } from '../api';

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

// 按真实页面（2026-10 熊祝成账号）结构：行首「1－2」，详情格 id 以 -2 结尾、周次里不带节次。
const realShapeHtml = `
<table id="kbtable">
<tr><th width="70" height="28" align="center">1－2&nbsp;</th>
<td><div id="19C8-1-1" class="kbcontent1">&nbsp;</div><div id="19C8-1-2" class="kbcontent">&nbsp;</div></td></tr>
<tr><th width="70" height="28" align="center">5－6&nbsp;</th>
<td><div id="7D2E-3-1" class="kbcontent1">最优控制</div>
<div id="7D2E-3-2" style="display: none;" class="kbcontent">最优控制<br/><font title='老师'>何智敏[教授]</font><br/><font title='周次(节次)'>1-12(周)</font><br/><font title='教室'>A座117</font><br/></div></td></tr>
</table>`;

describe('中南强智课表（真实页面结构）', () => {
  it('周次不带节次时用行首的小节范围', () => {
    expect(parseCsuTimetable(realShapeHtml)).toEqual([
      {
        kcmc: '最优控制',
        xm: '何智敏[教授]',
        zcd: '1-12(周)',
        jcs: '5-6',
        jc: '5-6节',
        cdmc: 'A座117',
        xqj: '3',
      },
    ]);
  });
});

describe('parseCsuSemesters', () => {
  it('读出学期下拉的全部学期并新到旧排列', () => {
    const html =
      '<select id="xnxq01id"><option value="2024-2025-1">2024-2025-1</option>' +
      "<option value='2026-2027-1' selected>2026-2027-1</option>" +
      '<option value="2025-2026-2">2025-2026-2</option><option value="">请选择</option></select>';
    expect(parseCsuSemesters(html)).toEqual(['2026-2027-1', '2025-2026-2', '2024-2025-1']);
  });
});

describe('currentSemester（中南两学期）', () => {
  it('8–12 月与 1 月为秋季学期，2–7 月为春季学期', () => {
    expect(currentSemester(new Date(2026, 9, 31))).toBe('2026-2027-1');
    expect(currentSemester(new Date(2027, 0, 10))).toBe('2026-2027-1');
    expect(currentSemester(new Date(2027, 2, 2))).toBe('2026-2027-2');
    expect(currentSemester(new Date(2027, 7, 1))).toBe('2027-2028-1');
  });
});

describe('parseCsuSemesterStart', () => {
  it('从教学周历首行取周一为开学日期', () => {
    const html =
      '<table id="kbtable"><tr><td>1</td><td title="2026年09月06">09月06日</td>' +
      '<td title="2026年09月07">07</td><td title="2026年09月08">08</td></tr></table>';
    expect(parseCsuSemesterStart(html)).toBe('2026-09-07');
    expect(parseCsuSemesterStart('<table></table>')).toBeNull();
  });
});
