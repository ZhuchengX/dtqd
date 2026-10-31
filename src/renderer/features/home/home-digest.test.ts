import { describe, expect, it } from 'vitest';
import type { TimetableLesson, TodoItem } from '../../../shared/api';
import { digestIsEmpty, dueDistance, homeDigest, todayEvents, todayLessons } from './home-digest';

// 2026-11-04 是周三；开学 2026-09-07（周一）→ 第 9 周。
const NOW = new Date(2026, 10, 4, 10, 0);
const START = '2026-09-07';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo',
    source: 'personal',
    title: '作业',
    notes: '',
    dueAt: null,
    status: 'pending',
    readAt: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function lesson(overrides: Partial<TimetableLesson> = {}): TimetableLesson {
  return {
    id: 1,
    semester: '2026-2027-1',
    courseCode: 'DI12006',
    courseName: 'Statistics',
    className: null,
    teacher: null,
    campus: null,
    classroom: 'A101',
    weekday: 3,
    startPeriod: 3,
    endPeriod: 4,
    periodsText: '3-4',
    weeksText: '1-16',
    weekNumbers: [],
    credits: null,
    note: null,
    ...overrides,
  };
}

describe('todayLessons', () => {
  it('只要今天、本周有的课，按节次排序', () => {
    const lessons = [
      lesson({ id: 2, startPeriod: 5, endPeriod: 6, courseName: 'Calculus' }),
      lesson({ id: 1 }),
      lesson({ id: 3, weekday: 4 }),
      lesson({ id: 4, weekNumbers: [1, 2] }),
    ];
    const today = todayLessons(lessons, START, NOW);
    expect(today.map((item) => item.id)).toEqual([1, 2]);
    expect(today[0]).toMatchObject({ title: 'Statistics', place: 'A101' });
    expect(today[0]!.time).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });

  it('没设开学日期或还没开学时为空', () => {
    expect(todayLessons([lesson()], null, NOW)).toEqual([]);
    expect(todayLessons([lesson()], '2027-01-01', NOW)).toEqual([]);
  });
});

describe('homeDigest', () => {
  it('分出两周内已过期、7 天内到期、未读；已完成的不要', () => {
    const items = [
      todo({ id: 'late', dueAt: new Date(2026, 10, 3).toISOString() }),
      todo({ id: 'stale', dueAt: new Date(2025, 10, 24).toISOString() }),
      todo({ id: 'soon2', dueAt: new Date(2026, 10, 8).toISOString() }),
      todo({ id: 'soon1', dueAt: new Date(2026, 10, 5).toISOString(), readAt: null }),
      todo({ id: 'far', dueAt: new Date(2026, 10, 30).toISOString() }),
      todo({ id: 'done', dueAt: new Date(2026, 10, 5).toISOString(), status: 'submitted' }),
      todo({ id: 'new', readAt: null }),
    ];
    const digest = homeDigest(items, [], START, NOW);
    expect(digest.overdue.map((item) => item.id)).toEqual(['late']);
    expect(digest.upcoming.map((item) => item.id)).toEqual(['soon1', 'soon2']);
    expect(digest.unread.map((item) => item.id).sort()).toEqual(['new', 'soon1']);
    expect(digestIsEmpty(digest)).toBe(false);
    expect(digestIsEmpty(homeDigest([], [], null, NOW))).toBe(true);
  });
});

describe('dueDistance', () => {
  it('分钟 / 小时 / 天，过去的写「已过」', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(dueDistance(at(20 * 60_000), NOW)).toBe('还剩 20 分钟');
    expect(dueDistance(at(3 * 3600_000), NOW)).toBe('还剩 3 小时');
    expect(dueDistance(at(2 * 86_400_000), NOW)).toBe('还剩 2 天');
    expect(dueDistance(at(-86_400_000), NOW)).toBe('已过 1 天');
  });
});

describe('todayEvents', () => {
  it('只要今天的自建与 Teams 日程，待办派生的不要', () => {
    const at = (h: number) => new Date(2026, 10, 4, h).toISOString();
    const events = todayEvents(
      [
        {
          id: 'teams:e1',
          title: 'Tutorial',
          startAt: at(14),
          endAt: at(15),
          location: 'Teams 会议',
          color: 'blue',
        },
        {
          id: 'todo:x',
          todoId: 'x',
          title: 'Due',
          startAt: at(9),
          endAt: at(9),
          location: null,
          color: null,
        },
        {
          id: 3,
          title: '明天',
          startAt: new Date(2026, 10, 5, 9).toISOString(),
          endAt: new Date(2026, 10, 5, 10).toISOString(),
          location: null,
          color: null,
        },
      ],
      NOW,
    );
    expect(events).toEqual([
      { id: 'teams:e1', title: 'Tutorial', time: '14:00–15:00', place: 'Teams 会议' },
    ]);
  });
});
