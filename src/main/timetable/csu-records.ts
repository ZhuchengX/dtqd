// 中南强智教务（jsxsd）的成绩、培养方案、考试安排：纯解析在前，网络请求在后，只读。
import { CampusAuthError, campusRequest, getCampusSession } from '../campus';
import { csuBase } from './api';
import { looksLikeCsuLoginPage, stripTags } from './csu';

/** 取 id 为 tableId 的表格，返回表头与数据行；rowspan 缺的左侧格沿用上一行。 */
export function parseCsuTable(
  html: string,
  tableId: string,
): { header: string[]; rows: string[][] } {
  const start = html.search(new RegExp(`<table[^>]*id=['"]${tableId}['"]`, 'i'));
  if (start < 0) return { header: [], rows: [] };
  const end = html.slice(start).search(/<\/table>/i);
  const table = html.slice(start, end < 0 ? undefined : start + end);
  const lines = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) =>
      stripTags(cell!).replace(/\s+/g, ' '),
    ),
  );
  const header = lines[0] ?? [];
  const rows: string[][] = [];
  for (const cells of lines.slice(1)) {
    // 「未查询到数据」之类的提示行只有一两格，不算数据。
    if (cells.length < Math.ceil(header.length / 2)) continue;
    const missing = header.length - cells.length;
    const previous = rows.at(-1);
    rows.push(missing > 0 && previous ? [...previous.slice(0, missing), ...cells] : cells);
  }
  return { header, rows };
}

/**
 * 按表头名取列。表头格里可能藏着另一段文字（成绩页是「考核方式课程属性」），
 * 所以按「以该名结尾」匹配第一列。
 */
function byHeader(header: string[], row: string[]): Record<string, string> {
  const keys = header.map((name) => name.replace(/\s+/g, ''));
  return new Proxy({} as Record<string, string>, {
    get: (_target, name) => {
      const index = keys.findIndex((key) => typeof name === 'string' && key.endsWith(name));
      return index < 0 ? undefined : (row[index] ?? '');
    },
  });
}

export interface CsuGrade {
  semester: string;
  firstSemester: string;
  courseCode: string;
  courseName: string;
  score: string;
  credits: number | null;
  /** 考核方式：考试 / 考查 / 其它。 */
  assessment: string;
  attribute: string;
  nature: string;
  method: string;
}

/** 课程格形如「[0901000101X1]项目（一）机械工程」。 */
function splitCourse(text: string): { code: string; name: string } {
  const match = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  return match ? { code: match[1]!, name: match[2]! } : { code: '', name: text };
}

export function parseCsuGrades(html: string): CsuGrade[] {
  const { header, rows } = parseCsuTable(html, 'dataList');
  return rows.map((row) => {
    const record = byHeader(header, row);
    const { code, name } = splitCourse(record['课程'] ?? '');
    const credits = Number(record['学分']);
    // 「课程属性」格实际是「考核方式 课程属性」两段，如「考试 必修」。
    const [assessment = '', attribute = ''] = (record['课程属性'] ?? '').split(' ');
    return {
      semester: record['获得学期'] ?? '',
      firstSemester: record['初修学期'] ?? '',
      courseCode: code,
      courseName: name,
      score: record['成绩'] ?? '',
      credits: Number.isFinite(credits) && record['学分'] ? credits : null,
      assessment: attribute ? assessment : '',
      attribute: attribute || assessment,
      nature: record['课程性质'] ?? '',
      method: record['获得方式'] ?? '',
    };
  });
}

export interface CsuPlanCourse {
  category: string;
  subcategory: string;
  courseCode: string;
  courseName: string;
  attribute: string;
  credits: number | null;
  hours: string;
  /** 开课学期序号（1–8），可能多个，如「7,8」。 */
  terms: number[];
  requirement: string;
}

/**
 * 培养方案课程表（#kctxTab）每门课一行 10 格：
 * 序号 | 课程类别 | 子类 | 编号 | 名称 | 属性 | 学分 | 学时 | 开课学期 | 学分要求。
 * 表头「课程类别」横跨两列；末尾的学分汇总行格数不同，跳过。
 */
export function parseCsuTrainingPlan(html: string): CsuPlanCourse[] {
  const { rows } = parseCsuTable(html, 'kctxTab');
  return rows
    .filter((cells) => cells.length === 10 && /^\d+$/.test(cells[0]!))
    .map(
      ([, category, subcategory, code, name, attribute, credits, hours, terms, requirement]) => ({
        category: category!,
        subcategory: subcategory!,
        courseCode: code!,
        courseName: name!,
        attribute: attribute!,
        credits: credits && Number.isFinite(Number(credits)) ? Number(credits) : null,
        hours: hours!,
        terms: (terms!.match(/\d+/g) ?? []).map(Number),
        requirement: requirement!,
      }),
    );
}

export interface CsuExam {
  stage: string;
  session: string;
  courseCode: string;
  courseName: string;
  time: string;
  room: string;
  seat: string;
  note: string;
}

export function parseCsuExams(html: string): CsuExam[] {
  const { header, rows } = parseCsuTable(html, 'dataList');
  return rows.map((row) => {
    const record = byHeader(header, row);
    return {
      stage: record['考试阶段'] ?? '',
      session: record['考试场次'] ?? '',
      courseCode: record['课程编号'] ?? '',
      courseName: record['课程名称'] ?? '',
      time: record['考试时间'] ?? '',
      room: record['考场'] ?? '',
      seat: record['座位号'] ?? '',
      note: record['备注说明'] ?? '',
    };
  });
}

async function csuPage(path: string, service: string, form?: Record<string, string>) {
  const html = await campusRequest(await getCampusSession(), `${csuBase()}${path}`, {
    service,
    loginError: '中南教务登录已失效，请在课表页重新登录',
    ...(form
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: new URLSearchParams(form).toString(),
        }
      : {}),
  });
  if (looksLikeCsuLoginPage(html))
    throw new CampusAuthError('中南教务登录已失效，请在课表页重新登录');
  return html;
}

/** semester 为空时取全部学期。 */
export async function fetchCsuGrades(semester = ''): Promise<CsuGrade[]> {
  return parseCsuGrades(await csuPage('kscj/cjcx_list', '中南教务成绩', { xnxq01id: semester }));
}

export async function fetchCsuTrainingPlan(): Promise<CsuPlanCourse[]> {
  return parseCsuTrainingPlan(await csuPage('pyfa/pyfazd_query', '中南教务培养方案'));
}

/** stage：1 期初、2 期中、3 期末，空为全部。 */
export async function fetchCsuExams(semester: string, stage = ''): Promise<CsuExam[]> {
  return parseCsuExams(
    await csuPage('xsks/xsksap_list', '中南教务考试安排', {
      xqlbmc: '',
      xnxqid: semester,
      xqlb: stage,
    }),
  );
}
