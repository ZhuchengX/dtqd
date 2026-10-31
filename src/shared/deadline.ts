// 截止时间：北京 / 英国双时区显示、分级提醒（3 天 / 1 天 / 3 小时）、导出 .ics。
// 邓迪的截止时间按英国时间写（GMT/BST 自动切换），学生在国内按北京时间过日子，两个都要看见。
import type { TodoItem } from './todo';

const HOUR = 3600_000;

export const reminderTiers = [
  { key: '3d', before: 72 * HOUR, label: '还剩 3 天' },
  { key: '1d', before: 24 * HOUR, label: '还剩 1 天' },
  { key: '3h', before: 3 * HOUR, label: '还剩 3 小时' },
] as const;
export type ReminderTierKey = (typeof reminderTiers)[number]['key'];

function zoned(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** 「11/24 09:40（英国 11/24 01:40）」；英国与北京同日同时（不会发生）时也照常写两段。 */
export function dualDueLabel(iso: string): string {
  return `${zoned(iso, 'Asia/Shanghai')}（英国 ${zoned(iso, 'Europe/London')}）`;
}

export function reminderKey(item: Pick<TodoItem, 'id' | 'dueAt'>, tier: ReminderTierKey): string {
  return `${item.id}|${item.dueAt}|${tier}`;
}

/**
 * 该不该现在提醒：已进入的最紧一档还没提醒过就返回它；同时把已进入的各档都算作已处理，
 * 这样第一次打开软件时离截止只剩 2 小时的作业只弹「3 小时」一次，不会连弹三条。
 */
export function dueReminder(
  item: Pick<TodoItem, 'id' | 'dueAt'>,
  now: number,
  fired: ReadonlySet<string>,
): { tier: (typeof reminderTiers)[number] | null; crossed: string[] } {
  if (!item.dueAt) return { tier: null, crossed: [] };
  const left = Date.parse(item.dueAt) - now;
  if (!Number.isFinite(left) || left <= 0) return { tier: null, crossed: [] };
  const entered = reminderTiers.filter((tier) => left <= tier.before);
  const tightest = entered.at(-1);
  if (!tightest) return { tier: null, crossed: [] };
  const crossed = entered.map((tier) => reminderKey(item, tier.key));
  return { tier: fired.has(reminderKey(item, tightest.key)) ? null : tightest, crossed };
}

function icsDate(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** RFC 5545 文本转义：反斜杠、分号、逗号、换行。 */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** 长行按 75 字节折行（续行以空格开头）；按字符切，中文不会被切坏。 */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (encoder.encode(current + char).length > 74) {
      parts.push(current);
      current = ' ';
    }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** 有截止时间的待办导出成日历文件：每件是截止时刻的 15 分钟事件，带提前 1 天与 3 小时的提醒。 */
export function todosIcs(items: readonly TodoItem[], now: Date): string {
  const stamp = icsDate(now.toISOString());
  const events = items
    .filter((item) => item.dueAt && Number.isFinite(Date.parse(item.dueAt)))
    .flatMap((item) => {
      const due = item.dueAt!;
      const end = new Date(Date.parse(due) + 15 * 60_000).toISOString();
      const summary = item.courseName ? `${item.title} · ${item.courseName}` : item.title;
      const alarm = (trigger: string) => [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(summary)}`,
        `TRIGGER:${trigger}`,
        'END:VALARM',
      ];
      return [
        'BEGIN:VEVENT',
        `UID:${icsText(item.id)}@dtqd`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(due)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsText(`截止：${summary}`)}`,
        ...(item.url ? [`URL:${item.url}`] : []),
        `DESCRIPTION:${icsText(`英国时间 ${zoned(due, 'Europe/London')}${item.notes ? `\n${item.notes}` : ''}`)}`,
        ...alarm('-P1D'),
        ...alarm('-PT3H'),
        'END:VEVENT',
      ];
    });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DTQD//Deadlines//ZH',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
