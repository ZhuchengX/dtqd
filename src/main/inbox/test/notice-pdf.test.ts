import { describe, expect, it } from 'vitest';
import { officePdfUrl, officeTitleWorthReading } from '../notice-pdf';

describe('officeTitleWorthReading', () => {
  it('和学生有关的读，面向教职工的不读', () => {
    expect(officeTitleWorthReading('【本科生院】关于举办光电设计竞赛选拔赛通知')).toBe(true);
    expect(officeTitleWorthReading('【体育教研部】关于调整田径运动会举办时间的通知')).toBe(true);
    expect(officeTitleWorthReading('【党委组织部】干部任前公示公告')).toBe(false);
    expect(officeTitleWorthReading('【学校办公室】关于公布学校领导分工情况的通知')).toBe(false);
    expect(officeTitleWorthReading('【人事处】教职工职称申报的通知')).toBe(false);
  });
});

describe('officePdfUrl', () => {
  it('从通知链接取 JLNM，其他站点或异常 id 返回 null', () => {
    expect(officePdfUrl('https://oa.csu.edu.cn/con/PDFPage?YWMC=G&JLNM=A1B2')).toBe(
      'https://oa.csu.edu.cn/con/xnbg/loadContentPdf/A1B2',
    );
    expect(officePdfUrl('https://dii.csu.edu.cn/info/1/1.htm')).toBeNull();
    expect(officePdfUrl('https://oa.csu.edu.cn/con/PDFPage?JLNM=../x')).toBeNull();
  });
});
