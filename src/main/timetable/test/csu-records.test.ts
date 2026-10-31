import { describe, expect, it } from 'vitest';
import { parseCsuExams, parseCsuGrades, parseCsuTrainingPlan } from '../csu-records';

// 按 2026-10 真实页面的表头结构手写，数值为虚构样例。
describe('parseCsuGrades', () => {
  it('按表头取字段，拆出课程编号', () => {
    const html = `<table id="dataList">
<tr><th></th><th>序号</th><th>初修学期</th><th>获得学期</th><th>课程</th><th>成绩</th><th>学分</th><th><span hidden>考核方式</span>课程属性</th><th>课程性质</th><th>获得方式</th></tr>
<tr><td>+</td><td>1</td><td>2022-2023-1</td><td>2022-2023-1</td><td>[0901000101X1]项目（一）机械工程</td><td><a href="#">85</a></td><td>2</td><td>考试 必修</td><td>公共基础课</td><td>正常考试</td></tr>
</table>`;
    expect(parseCsuGrades(html)).toEqual([
      {
        semester: '2022-2023-1',
        firstSemester: '2022-2023-1',
        courseCode: '0901000101X1',
        courseName: '项目（一）机械工程',
        score: '85',
        credits: 2,
        assessment: '考试',
        attribute: '必修',
        nature: '公共基础课',
        method: '正常考试',
      },
    ]);
  });
});

describe('parseCsuTrainingPlan', () => {
  it('每行 10 格：类别、子类、学分、开课学期（可多个），跳过汇总行', () => {
    const html = `<TABLE id="kctxTab">
<tr><th>序号</th><th colspan="2">课程类别</th><th>课程编号</th><th>课程名称</th><th>课程属性</th><th>学分</th><th>总学时(周)</th><th>开课学期</th><th>学分要求</th></tr>
<tr><td>1</td><td>通识教育课程</td><td>思政类</td><td>210101T10</td><td>思想道德修养与法律基础</td><td>必修</td><td>3</td><td>48</td><td>1</td><td>必修18学分</td></tr>
<tr><td>54</td><td>专业教育课程</td><td>集中实践环节</td><td>130173Z10</td><td>个人研究项目</td><td>必修</td><td>16</td><td>16周</td><td>7,8</td><td>必修16学分</td></tr>
<tr><td>通识教育课程</td><td>文化素质类学分</td><td>通识教育课程体系中文化素质类</td><td>6学分</td></tr>
</TABLE>`;
    const plan = parseCsuTrainingPlan(html);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      category: '通识教育课程',
      subcategory: '思政类',
      credits: 3,
      terms: [1],
    });
    expect(plan[1]).toMatchObject({ courseName: '个人研究项目', hours: '16周', terms: [7, 8] });
  });
});

describe('parseCsuExams', () => {
  it('无数据提示行不算考试', () => {
    const html = `<table id="dataList">
<tr><th>序号</th><th>考试阶段</th><th>考试场次</th><th>课程编号</th><th>课程名称</th><th>考试时间</th><th>考场</th><th>座位号</th><th>准考证号</th><th>备注说明</th><th>操作</th></tr>
<tr><td colspan="11">未查询到数据</td></tr>
</table>`;
    expect(parseCsuExams(html)).toEqual([]);
  });
});
