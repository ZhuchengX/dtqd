// 截止分级提醒：每 5 分钟看一遍没完成的待办，进入 3 天 / 1 天 / 3 小时档时各弹一次系统通知；
// 另提供导出 .ics，把截止时间放进系统日历或手机日历。
import { writeFile } from 'node:fs/promises';
import { dialog, ipcMain } from 'electron';
import { dualDueLabel, dueReminder, todosIcs } from '../../shared/deadline';
import { todoCompleted, type TodoItem } from '../../shared/todo';
import { checkWorkspaceSender } from '../ipc';
import { systemNotifyReminder } from '../notifications/system';
import { readSetting, writeSetting } from '../settings/prefs';
import { getTodoState } from '.';

const FIRED_KEY = 'todo-reminders-fired';
const CHECK_INTERVAL_MS = 5 * 60_000;
const STARTUP_DELAY_MS = 30_000;

function firedKeys(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readSetting(FIRED_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function openDated(items: readonly TodoItem[]): TodoItem[] {
  return items.filter((item) => item.dueAt && !todoCompleted(item.status));
}

/** 扫一遍并弹该弹的提醒；返回弹出的条数。已过期或已完成的待办的记录顺手清掉。 */
export function checkReminders(
  items: readonly TodoItem[],
  now: number,
  notify: (title: string, body: string, todoId: string) => void,
): number {
  const fired = firedKeys();
  const kept = new Set<string>();
  let shown = 0;
  for (const item of openDated(items)) {
    const { tier, crossed } = dueReminder(item, now, fired);
    for (const key of crossed) kept.add(key);
    if (!tier) continue;
    const course = item.courseName ? ` · ${item.courseName}` : '';
    notify(`${tier.label}：${item.title}`, `截止 ${dualDueLabel(item.dueAt!)}${course}`, item.id);
    shown += 1;
  }
  writeSetting(FIRED_KEY, JSON.stringify([...kept]));
  return shown;
}

let timer: NodeJS.Timeout | null = null;

export function scheduleReminders(): void {
  if (timer) return;
  const tick = () => {
    try {
      checkReminders(getTodoState().items, Date.now(), systemNotifyReminder);
    } catch (error) {
      console.error('[reminders] 检查失败', error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export async function exportDeadlinesIcs(): Promise<number | null> {
  const items = openDated(getTodoState().items);
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: 'DTQD 截止时间.ics',
    filters: [{ name: '日历', extensions: ['ics'] }],
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, todosIcs(items, new Date()), 'utf8');
  return items.length;
}

export function registerReminderIpc(): void {
  ipcMain.handle('todo:export-ics', (event) => {
    checkWorkspaceSender(event);
    return exportDeadlinesIcs();
  });
}
