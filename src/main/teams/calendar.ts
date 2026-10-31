// Teams 日历日程：每次同步覆盖保存一份，课表与日历按时间范围只读合并显示（不可在 DTQD 里删改）。
import type { CalendarEvent } from '../../shared/timetable';
import { readSetting, writeSetting } from '../settings/prefs';
import type { RawTeamsEvent } from './extract';

const KEY = 'teams-calendar';
export const TEAMS_EVENT_PREFIX = 'teams:';

export function saveTeamsEvents(events: readonly RawTeamsEvent[]): void {
  writeSetting(KEY, JSON.stringify(events.filter((event) => !event.cancelled)));
}

function savedEvents(): RawTeamsEvent[] {
  try {
    const parsed: unknown = JSON.parse(readSetting(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RawTeamsEvent[]) : [];
  } catch {
    return [];
  }
}

/** 与 [startAt, endAt) 相交的 Teams 日程，转成日历事件；id 带 teams: 前缀，界面据此不给删除。 */
export function teamsCalendarEvents(startAt: string, endAt: string): CalendarEvent[] {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return savedEvents()
    .filter((event) => Date.parse(event.end) > start && Date.parse(event.start) < end)
    .map((event) => ({
      id: `${TEAMS_EVENT_PREFIX}${event.id}`,
      title: event.subject || 'Teams 日程',
      startAt: event.start,
      endAt: event.end,
      location: event.location || (event.online ? 'Teams 会议' : null),
      color: 'blue',
    }));
}
