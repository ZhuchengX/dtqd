// 首页「今天 / 本周」：从课表与待办里挑出今天的课、已过期与 7 天内到期的事、未读的新事项。
import type { TimetableLesson, TodoItem } from '../../../shared/api';
import { todoCompleted } from '../../../shared/todo';
import {
  activeInWeek,
  dayMilliseconds,
  formatMinuteOfDay,
  periodBoundary,
  weekForDate,
} from '../timetable/timetable-format';

const OVERDUE_DAYS = 14;

export interface DigestLesson {
  readonly id: number;
  readonly title: string;
  readonly time: string;
  readonly place: string | null;
}

export interface HomeDigest {
  readonly lessons: readonly DigestLesson[];
  readonly overdue: readonly TodoItem[];
  readonly upcoming: readonly TodoItem[];
  readonly unread: readonly TodoItem[];
}

/** 周一 = 1 … 周日 = 7，与课表 weekday 一致。 */
function lessonWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export function todayLessons(
  lessons: readonly TimetableLesson[],
  semesterStart: string | null,
  now: Date,
): DigestLesson[] {
  const week = weekForDate(semesterStart, now);
  if (week === null || week < 1) return [];
  const weekday = lessonWeekday(now);
  return lessons
    .filter((lesson) => lesson.weekday === weekday && activeInWeek(lesson, week))
    .sort((a, b) => a.startPeriod - b.startPeriod)
    .map((lesson) => ({
      id: lesson.id,
      title: lesson.courseName || lesson.courseCode,
      time: `${formatMinuteOfDay(periodBoundary(lesson.startPeriod, 'start'))}–${formatMinuteOfDay(periodBoundary(lesson.endPeriod, 'end'))}`,
      place: lesson.classroom,
    }));
}

function byDue(a: TodoItem, b: TodoItem): number {
  return Date.parse(a.dueAt!) - Date.parse(b.dueAt!);
}

export function homeDigest(
  items: readonly TodoItem[],
  lessons: readonly TimetableLesson[],
  semesterStart: string | null,
  now: Date,
  days = 7,
): HomeDigest {
  const open = items.filter((item) => !todoCompleted(item.status));
  const dated = open.filter((item) => item.dueAt && Number.isFinite(Date.parse(item.dueAt)));
  const time = now.getTime();
  const horizon = time + days * dayMilliseconds;
  return {
    lessons: todayLessons(lessons, semesterStart, now),
    // 过期太久的多半是上学期没同步掉的旧作业，只看最近两周。
    overdue: dated
      .filter((item) => {
        const due = Date.parse(item.dueAt!);
        return due < time && due >= time - OVERDUE_DAYS * dayMilliseconds;
      })
      .sort(byDue),
    upcoming: dated
      .filter((item) => {
        const due = Date.parse(item.dueAt!);
        return due >= time && due <= horizon;
      })
      .sort(byDue),
    unread: open
      .filter((item) => item.readAt === null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

export function digestIsEmpty(digest: HomeDigest): boolean {
  return (
    digest.lessons.length === 0 &&
    digest.overdue.length === 0 &&
    digest.upcoming.length === 0 &&
    digest.unread.length === 0
  );
}

/** 「还剩 3 小时 / 还剩 2 天 / 已过 1 天」。 */
export function dueDistance(dueAt: string, now: Date): string {
  const diff = Date.parse(dueAt) - now.getTime();
  const abs = Math.abs(diff);
  const amount =
    abs < 3600_000
      ? `${Math.max(1, Math.round(abs / 60_000))} 分钟`
      : abs < dayMilliseconds
        ? `${Math.round(abs / 3600_000)} 小时`
        : `${Math.round(abs / dayMilliseconds)} 天`;
  return diff >= 0 ? `还剩 ${amount}` : `已过 ${amount}`;
}
