import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '../../../shared/todo';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => settings.set(key, value),
}));
vi.mock('electron', () => ({ dialog: {}, ipcMain: { handle: vi.fn() } }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../notifications/system', () => ({ systemNotifyReminder: vi.fn() }));
vi.mock('..', () => ({ getTodoState: vi.fn() }));
import { checkReminders } from '../reminders';

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
    courseName: 'Physics',
    ...overrides,
  };
}

beforeEach(() => settings.clear());

describe('checkReminders', () => {
  it('每档只弹一次，标题带剩余时间，正文带双时区与课程', () => {
    const notify = vi.fn();
    expect(checkReminders([todo()], due - 20 * 3600_000, notify)).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      '还剩 1 天：Coursework 1',
      '截止 11/24 20:00（英国 11/24 12:00） · Physics',
      'a1',
    );
    expect(checkReminders([todo()], due - 19 * 3600_000, notify)).toBe(0);
    expect(checkReminders([todo()], due - 2 * 3600_000, notify)).toBe(1);
  });

  it('已提交的不提醒，记录随之清掉', () => {
    const notify = vi.fn();
    checkReminders([todo()], due - 20 * 3600_000, notify);
    checkReminders([todo({ status: 'submitted' })], due - 2 * 3600_000, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(settings.get('todo-reminders-fired')).toBe('[]');
  });

  it('设置里存的记录损坏时当作没有', () => {
    settings.set('todo-reminders-fired', '{坏');
    expect(checkReminders([todo()], due - 20 * 3600_000, vi.fn())).toBe(1);
  });
});
