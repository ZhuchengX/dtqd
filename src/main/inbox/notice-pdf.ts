// 校内办公网通知正文：标题初筛后，只把可能和学生有关的 PDF 取来抽文字。只抽文字，不渲染、不落盘。
const RELEVANT =
  /学生|本科|学院|竞赛|大赛|选拔|奖学金|助学|资助|推免|保研|考研|实习|就业|招聘|交流|出国|留学|考试|四六级|英语|选课|教务|教学|课程|学期|放假|校历|停课|停水|停电|校园|图书馆|讲座|报名|申报|体育|运动会|军训|医保|体测|宿舍|网络|信息系统/;
const NOT_FOR_STUDENTS =
  /干部|教职工|职称|采购|招标|离退休|工会|党支部|党费|科研项目|基金项目|博士后|教师节|师资/;

/** 标题初筛：明显面向教职工的不读，其余要命中和学生有关的词。 */
export function officeTitleWorthReading(title: string): boolean {
  return RELEVANT.test(title) && !NOT_FOR_STUDENTS.test(title);
}

/** 通知链接 → 正文 PDF 地址；不是办公网通知返回 null。 */
export function officePdfUrl(noticeUrl: string): string | null {
  const url = new URL(noticeUrl);
  const id = url.searchParams.get('JLNM');
  if (url.hostname !== 'oa.csu.edu.cn' || !id || !/^\w+$/.test(id)) return null;
  return `https://oa.csu.edu.cn/con/xnbg/loadContentPdf/${id}`;
}

const MAX_PDF_PAGES = 6;

export async function pdfText(data: Uint8Array): Promise<string> {
  // 先载入 worker 模块：pdf.js 在主进程打包后找不到独立 worker 文件，有 globalThis.pdfjsWorker 就在本线程跑。
  // @ts-expect-error pdfjs-dist 没有给 worker 模块发类型声明。
  const worker: unknown = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data, verbosity: 0 });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PDF_PAGES); number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    }
    return pages.join('\n').trim();
  } finally {
    await task.destroy();
  }
}
