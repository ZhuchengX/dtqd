// Teams 日历日程：每次同步覆盖保存一份，课表与日历按时间范围只读合并显示（不可在 DTQD 里删改）。
import type { CalendarEvent } from '../../shared/timetable';
import { readSetting, writeSetting } from '../settings/prefs';
import type { RawTeamsEvent } from './extract';

const KEY = 'teams-calendar';
export const TEAMS_EVENT_PREFIX = 'teams:';

export function saveTeamsEvents(events: readonly RawTeamsEvent[]): void {
  writeSetting(KEY, JSON.stringify(events.filter((event) => !event.cancelled)));
}

export function clearTeamsEvents(): void {
  writeSetting(KEY, '[]');
}

function savedEvents(): RawTeamsEvent[] {
  try {
    const parsed: unknown = JSON.parse(readSetting(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RawTeamsEvent[]) : [];
  } catch {
    return [];
  }
}

const DAY_MS = 86_400_000;

/**
 * Teams 的全天日程存的是 UTC 午夜到 UTC 午夜，直接显示在北京时间就成了「早上 8 点到次日 8 点」。
 * 时长是整天数就当全天，换成本地日期的午夜；不是 UTC 午夜起的（按组织者时区存的）取本地日期。
 */
function allDaySpan(event: RawTeamsEvent): { startAt: string; endAt: string } | null {
  const start = new Date(event.start);
  const length = Date.parse(event.end) - start.getTime();
  if (!(length > 0) || length % DAY_MS !== 0) return null;
  const utcMidnight = start.getTime() % DAY_MS === 0;
  const [year, month, day] = utcMidnight
    ? [start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()]
    : [start.getFullYear(), start.getMonth(), start.getDate()];
  return {
    startAt: new Date(year, month, day).toISOString(),
    endAt: new Date(year, month, day + length / DAY_MS).toISOString(),
  };
}

/** 与 [startAt, endAt) 相交的 Teams 日程，转成日历事件；id 带 teams: 前缀，界面据此不给删除。 */
export function teamsCalendarEvents(startAt: string, endAt: string): CalendarEvent[] {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return savedEvents()
    .filter((event) => Date.parse(event.end) > start && Date.parse(event.start) < end)
    .map((event) => {
      const allDay = allDaySpan(event);
      return {
        id: `${TEAMS_EVENT_PREFIX}${event.id}`,
        title: event.subject || 'Teams 日程',
        startAt: allDay?.startAt ?? event.start,
        endAt: allDay?.endAt ?? event.end,
        location: event.location || (event.online ? 'Teams 会议' : null),
        color: 'blue',
        ...(allDay ? { allDay: true } : {}),
      };
    });
}
