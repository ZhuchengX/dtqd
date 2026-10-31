import { z } from 'zod';
import {
  fetchCsuExams,
  fetchCsuGrades,
  fetchCsuTrainingPlan,
} from '../../../timetable/csu-records';
import { limit, offset, page, query, tool, type AgentTool } from '../shared';

const semester = z.string().regex(/^\d{4}-\d{4}-[12]$/, '学期格式为 2025-2026-1');
const matches = (text: string, keyword: string) => !keyword || text.includes(keyword);

const listGradesTool = tool(
  '读取中南教务系统「我的成绩」（只读）：每门课的获得学期、成绩、学分、课程属性与性质。不传 semester 为全部学期。需先在课表页登录中南教务。',
  z.object({ semester: semester.optional(), query, offset, limit }).strict(),
  async ({ semester, query, offset, limit }) => {
    const grades = (await fetchCsuGrades(semester ?? '')).filter((grade) =>
      matches(`${grade.courseCode}${grade.courseName}`, query),
    );
    return page(grades, offset, limit);
  },
);

const trainingPlanTool = tool(
  '读取中南教务系统「培养方案」课程表（只读）：课程类别、编号、名称、必修/选修、学分、学时、开课学期（1–8）与学分要求。可按开课学期或关键词筛选。',
  z.object({ term: z.number().int().min(1).max(8).optional(), query, offset, limit }).strict(),
  async ({ term, query, offset, limit }) => {
    const courses = (await fetchCsuTrainingPlan()).filter(
      (course) =>
        (term === undefined || course.terms.includes(term)) &&
        matches(
          `${course.category}${course.subcategory}${course.courseCode}${course.courseName}`,
          query,
        ),
    );
    return page(courses, offset, limit);
  },
);

const listExamsTool = tool(
  '读取中南教务系统「我的考试」安排（只读）：考试阶段、课程、时间、考场、座位号。DIICSU 多数考试在 MyDundee 发布，这里常为空，空时去 Blackboard / 邮件 / QQ 群文件找。',
  z
    .object({
      semester,
      stage: z.enum(['', '1', '2', '3']).default('').describe('1 期初、2 期中、3 期末，空为全部'),
    })
    .strict(),
  async ({ semester, stage }) => ({ exams: await fetchCsuExams(semester, stage) }),
);

export const csuTools = {
  list_csu_grades: listGradesTool,
  get_csu_training_plan: trainingPlanTool,
  list_csu_exams: listExamsTool,
} satisfies Record<string, AgentTool>;
