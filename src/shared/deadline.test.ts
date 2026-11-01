import { describe, expect, it } from 'vitest';
import type { TodoItem } from './todo';
import { dualDueLabel, dueReminder, reminderKey, todosIcs } from './deadline';

const HOUR = 3600_000;
const DUE = '2026-11-24T12:00:00Z';
const due = Date.parse(DUE);

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'a1',
    source: 'canvas',
    title: 'Coursework 1',
    notes: '',
    dueAt: DUE,
    status: 'pending',
    readAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('dualDueLabel', () => {
  it('北京与英国时间都写（11 月英国为 GMT，差 8 小时）', () => {
    expect(dualDueLabel(DUE, new Date(2026, 0, 1))).toBe('11/24 20:00（英国 11/24 12:00）');
  });

  it('不是今年的带年份', () => {
    expect(dualDueLabel(DUE, new Date(2027, 0, 1))).toBe('2026/11/24 20:00（英国 11/24 12:00）');
  });

  it('夏令时期间差 7 小时', () => {
    expect(dualDueLabel('2026-06-01T12:00:00Z')).toBe('6/1 20:00（英国 6/1 13:00）');
  });
});

describe('dueReminder', () => {
  it('还早时不提醒；进入 3 天档提醒一次', () => {
    const item = todo();
    expect(dueReminder(item, due - 100 * HOUR, new Set()).tier).toBeNull();
    const first = dueReminder(item, due - 70 * HOUR, new Set());
    expect(first.tier?.key).toBe('3d');
    expect(dueReminder(item, due - 69 * HOUR, new Set(first.crossed)).tier).toBeNull();
  });

  it('第一次看到时已只剩 2 小时：只弹 3 小时档，三档都记为已处理', () => {
    const result = dueReminder(todo(), due - 2 * HOUR, new Set());
    expect(result.tier?.key).toBe('3h');
    expect(result.crossed).toHaveLength(3);
  });

  it('截止时间改了算新的提醒；过了截止不提醒', () => {
    const fired = new Set([reminderKey(todo(), '1d')]);
    expect(dueReminder(todo({ dueAt: '2026-11-25T12:00:00Z' }), due, fired).tier?.key).toBe('1d');
    expect(dueReminder(todo(), due + HOUR, new Set()).tier).toBeNull();
    expect(dueReminder(todo({ dueAt: null }), due, new Set()).tier).toBeNull();
  });
});

describe('todosIcs', () => {
  it('每件一个事件，带两个提醒，转义特殊字符，无截止的跳过', () => {
    const ics = todosIcs(
      [
        todo({ title: 'Lab; part 1, draft', courseName: 'Physics' }),
        todo({ id: 'x', dueAt: null }),
      ],
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART:20261124T120000Z');
    expect(ics).toContain('SUMMARY:截止：Lab\\; part 1\\, draft · Physics');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('TRIGGER:-PT3H');
  });

  it('长行折成不超过 75 字节', () => {
    const ics = todosIcs([todo({ title: '很长的作业标题'.repeat(10) })], new Date());
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
