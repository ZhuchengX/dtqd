// 首页「今天 / 本周」面板：今天的课、已过期、7 天内到期、新事项；全空时不显示，保持原首页样子。
import { useEffect, useState } from 'react';
import type { CalendarEvent, TimetableLesson, TodoItem } from '../../../shared/api';
import { useNavigationStore } from '../../navigation/view';
import { cn } from '../../lib/utils';
import { dualDueLabel } from '../../../shared/deadline';
import { digestIsEmpty, dueDistance, homeDigest } from './home-digest';

const LIST_LIMIT = 5;

interface Sources {
  items: readonly TodoItem[];
  lessons: readonly TimetableLesson[];
  semesterStart: string | null;
  events: readonly CalendarEvent[];
}

function useDigestSources(): Sources {
  const [sources, setSources] = useState<Sources>({
    items: [],
    lessons: [],
    semesterStart: null,
    events: [],
  });
  useEffect(() => {
    const api = window.dela;
    // 浏览器预览或测试替身可能没有 todo / timetable 接口，首页照常显示。
    if (!api?.todo || !api.timetable) return;
    let active = true;
    const setItems = (items: readonly TodoItem[]) =>
      active && setSources((current) => ({ ...current, items }));
    void api.todo.getState().then((state) => setItems(state.items));
    const unsubscribe = api.todo.onUpdate((state) => setItems(state.items));
    // 没连课表时这两个调用可能失败，首页只是少一块，不打扰用户。
    void Promise.all([api.timetable.getState(), api.timetable.listLessons()])
      .then(([state, lessons]) => {
        if (active)
          setSources((current) => ({ ...current, lessons, semesterStart: state.semesterStart }));
      })
      .catch(() => undefined);
    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    void api.timetable
      .listEvents(dayStart.toISOString(), new Date(dayStart.getTime() + 86_400_000).toISOString())
      .then((events) => {
        if (active) setSources((current) => ({ ...current, events }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return sources;
}

function TodoRow({ item, now, urgent }: { item: TodoItem; now: Date; urgent?: boolean }) {
  return (
    <li>
      <button
        className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-hover"
        onClick={() => useNavigationStore.getState().openTodo(item.id)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-13 text-ink">{item.title}</span>
        {item.dueAt && (
          <span className={cn('shrink-0 text-xs', urgent ? 'text-red' : 'text-ink-3')}>
            {dualDueLabel(item.dueAt)} · {dueDistance(item.dueAt, now)}
          </span>
        )}
      </button>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h2 className="px-2 text-xs font-medium text-ink-3">{title}</h2>
      <ul className="grid">{children}</ul>
    </section>
  );
}

function More({ count }: { count: number }) {
  if (count <= LIST_LIMIT) return null;
  return <li className="px-2 text-xs text-ink-3">还有 {count - LIST_LIMIT} 件，在侧栏待办里看</li>;
}

export function HomeDigest() {
  const { items, lessons, semesterStart, events } = useDigestSources();
  const now = new Date();
  const digest = homeDigest(items, lessons, semesterStart, now, events);
  if (digestIsEmpty(digest)) return null;
  const upcomingIds = new Set(digest.upcoming.map((item) => item.id));
  const overdueIds = new Set(digest.overdue.map((item) => item.id));
  // 新事项里已经出现在到期列表的不再重复列。
  const unread = digest.unread.filter(
    (item) => !upcomingIds.has(item.id) && !overdueIds.has(item.id),
  );

  return (
    <div className="mx-auto mb-6 grid w-full max-w-2xl gap-4 rounded-xl border border-line bg-surface p-3">
      {digest.lessons.length > 0 && (
        <Group title="今天的课与日程">
          {digest.lessons.map((lesson) => (
            <li className="flex items-baseline gap-2 px-2 py-1 text-13" key={lesson.id}>
              <span className="shrink-0 tabular-nums text-ink-3">{lesson.time}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{lesson.title}</span>
              {lesson.place && <span className="shrink-0 text-xs text-ink-3">{lesson.place}</span>}
            </li>
          ))}
        </Group>
      )}
      {digest.overdue.length > 0 && (
        <Group title="已过期还没完成">
          {digest.overdue.slice(0, LIST_LIMIT).map((item) => (
            <TodoRow item={item} key={item.id} now={now} urgent />
          ))}
          <More count={digest.overdue.length} />
        </Group>
      )}
      {digest.upcoming.length > 0 && (
        <Group title="7 天内到期">
          {digest.upcoming.slice(0, LIST_LIMIT).map((item) => (
            <TodoRow
              item={item}
              key={item.id}
              now={now}
              urgent={Date.parse(item.dueAt!) - now.getTime() < 86_400_000}
            />
          ))}
          <More count={digest.upcoming.length} />
        </Group>
      )}
      {unread.length > 0 && (
        <Group title="新事项">
          {unread.slice(0, LIST_LIMIT).map((item) => (
            <TodoRow item={item} key={item.id} now={now} />
          ))}
          <More count={unread.length} />
        </Group>
      )}
    </div>
  );
}
