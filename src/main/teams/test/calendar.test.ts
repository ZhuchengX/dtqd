import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => settings.set(key, value),
}));
import { saveTeamsEvents, teamsCalendarEvents } from '../calendar';

const event = (over: Partial<Parameters<typeof saveTeamsEvents>[0][number]> = {}) => ({
  id: 'e1',
  subject: 'MA22004 Tutorial',
  start: '2026-11-04T02:00:00.000Z',
  end: '2026-11-04T03:00:00.000Z',
  location: '',
  organizer: 'Dr Smith',
  online: true,
  cancelled: false,
  ...over,
});

beforeEach(() => settings.clear());

describe('Teams 日程', () => {
  it('按时间范围取，转成只读日历事件；取消的不要', () => {
    saveTeamsEvents([
      event(),
      event({ id: 'e2', cancelled: true }),
      event({ id: 'e3', start: '2026-12-01T00:00:00Z', end: '2026-12-01T01:00:00Z' }),
    ]);
    expect(teamsCalendarEvents('2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z')).toEqual([
      {
        id: 'teams:e1',
        title: 'MA22004 Tutorial',
        startAt: '2026-11-04T02:00:00.000Z',
        endAt: '2026-11-04T03:00:00.000Z',
        location: 'Teams 会议',
        color: 'blue',
      },
    ]);
  });

  it('没同步过或存的数据损坏时为空', () => {
    expect(teamsCalendarEvents('2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z')).toEqual([]);
    settings.set('teams-calendar', '{坏');
    expect(teamsCalendarEvents('2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z')).toEqual([]);
  });
});

describe('Teams 全天日程', () => {
  it('整天时长的日程按本地日期算全天，普通日程不动', () => {
    saveTeamsEvents([
      {
        id: 'day',
        subject: '全天',
        start: '2026-10-26T00:00:00.000Z',
        end: '2026-10-27T00:00:00.000Z',
        location: '',
        organizer: '',
        online: false,
        cancelled: false,
      },
      {
        id: 'meet',
        subject: '会议',
        start: '2026-10-26T12:00:00.000Z',
        end: '2026-10-26T12:20:00.000Z',
        location: '',
        organizer: '',
        online: false,
        cancelled: false,
      },
    ]);
    const [day, meet] = teamsCalendarEvents('2026-10-25T00:00:00Z', '2026-11-01T00:00:00Z');
    expect(day).toMatchObject({
      allDay: true,
      startAt: new Date(2026, 9, 26).toISOString(),
      endAt: new Date(2026, 9, 27).toISOString(),
    });
    expect(meet).toMatchObject({ startAt: '2026-10-26T12:00:00.000Z' });
    expect(meet?.allDay).toBeUndefined();
  });
});
