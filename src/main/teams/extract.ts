// 从 Teams 网页客户端自己的本地缓存（IndexedDB）读取已同步的会话与消息。
// 只读 conversation-manager / replychain-manager 两个库，不碰登录、令牌相关的存储，也不发任何网络请求。

/** 页面内返回的原始会话。 */
export interface RawTeamsConversation {
  id: string;
  threadType: string;
  topic: string;
  teamId: string;
  lastMessageTime: number;
}

/** 页面内返回的原始消息。 */
export interface RawTeamsMessage {
  conversationId: string;
  replyChainId: string;
  id: string;
  time: number;
  author: string;
  messageType: string;
  content: string;
}

/** 「动态」里与我有关的一条（@我、回复我等）；只取类型与指向的消息，不取内容。 */
export interface RawTeamsActivity {
  type: string;
  conversationId: string;
  messageId: string;
  time: number;
}

/** Teams 日历里的一个日程（课程会议、答疑、讲座等）。 */
export interface RawTeamsEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  online: boolean;
  cancelled: boolean;
}

export interface RawTeamsSnapshot {
  conversations: RawTeamsConversation[];
  messages: RawTeamsMessage[];
  /** 旧版脚本或页面里没有对应库时缺省。 */
  activities?: RawTeamsActivity[];
  events?: RawTeamsEvent[];
  /** 本次读到的最新送达时间，下次增量从这里开始。 */
  latest: number;
}

/**
 * 在 Teams 页面里执行的脚本：返回 latestDeliveryTime > since 的消息链里、到达时间 > since 的消息。
 * 用 String.raw 拼成源码交给 executeJavaScript；since 是数字，直接内联。
 */
export function extractScript(since: number): string {
  return String.raw`(async () => {
    const since = ${Math.max(0, Math.floor(since))};
    const all = await indexedDB.databases();
    const pick = (part) => all.find((d) => d.name && d.name.includes(':' + part + ':'))?.name;
    const open = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.transaction.abort();
    });
    const each = (db, store, visit) => new Promise((resolve, reject) => {
      const cursor = db.transaction(store, 'readonly').objectStore(store).openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return resolve();
        visit(current.value);
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    const conversationDb = pick('conversation-manager');
    const replyDb = pick('replychain-manager');
    if (!conversationDb || !replyDb) return { conversations: [], messages: [], latest: since, missing: true };

    const conversations = [];
    const cdb = await open(conversationDb);
    await each(cdb, 'conversations', (c) => {
      const tp = c.threadProperties || {};
      conversations.push({
        id: String(c.id),
        threadType: String(tp.threadType || c.type || ''),
        topic: String(tp.spaceThreadTopic || tp.topic || ''),
        teamId: String(c.teamId || ''),
        lastMessageTime: Number(c.lastMessageTimeUtc || 0),
      });
    });
    cdb.close();

    const messages = [];
    let latest = since;
    const rdb = await open(replyDb);
    await each(rdb, 'replychains-2', (chain) => {
      // 48: 开头是通话记录、通知等系统会话，不是消息。
      if (String(chain.conversationId).startsWith('48:')) return;
      const delivered = Number(chain.latestDeliveryTime || 0);
      if (delivered <= since) return;
      if (delivered > latest) latest = delivered;
      for (const m of Object.values(chain.messageMap || {})) {
        const time = Number(m.originalArrivalTime || m.clientArrivalTime || 0);
        if (time <= since || m.deletionInfo) continue;
        messages.push({
          conversationId: String(chain.conversationId),
          replyChainId: String(chain.replyChainId),
          id: String(m.id),
          time,
          author: String(m.imDisplayName || ''),
          messageType: String(m.messageType || ''),
          content: String(m.content || ''),
        });
      }
    });
    rdb.close();

    // 动态（@我、回复我）与日历是锦上添花：库不在或读失败都不影响消息同步。
    const activities = [];
    const events = [];
    const iso = (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    };
    try {
      const activityDb = pick('activity-manager');
      if (activityDb) {
        const adb = await open(activityDb);
        await each(adb, 'feed-items', (a) => {
          activities.push({
            type: String(a.activityType || ''),
            conversationId: String(a.sourceThreadId || ''),
            messageId: String(a.sourceMessageId || a.messageId || ''),
            time: Number(a.timestamp || 0),
          });
        });
        adb.close();
      }
    } catch {}
    try {
      const calendarDb = pick('calendar');
      if (calendarDb) {
        const kdb = await open(calendarDb);
        await each(kdb, 'calendar', (e) => {
          const start = iso(e.startTime);
          const end = iso(e.endTime);
          if (!start || !end) return;
          events.push({
            id: String(e.objectId || e.iCalUID || start),
            subject: String(e.subject || ''),
            start,
            end,
            location: String(e.location || ''),
            organizer: String(e.organizerName || ''),
            online: Boolean(e.isOnlineMeeting),
            cancelled: Boolean(e.isCancelled),
          });
        });
        kdb.close();
      }
    } catch {}
    return { conversations, messages, latest, activities, events };
  })()`;
}

/** Teams 消息正文是 HTML：转成纯文本，保留换行与链接地址。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_m, href: string, text: string) =>
      text.includes(href) ? text : `${text} (${href})`,
    )
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 只保留人发的文字消息；系统事件（加人、改名、通话记录等）跳过。 */
export function isUserMessage(message: RawTeamsMessage): boolean {
  return /^(Text|RichText(\/Html)?|RichText\/Media_Card)$/i.test(message.messageType);
}

export type TeamsConversationKind = '频道' | '会议' | '群聊' | '私聊' | '其他';

export function conversationKind(conversation: RawTeamsConversation): TeamsConversationKind {
  const type = conversation.threadType.toLowerCase();
  if (type === 'topic' || type === 'space' || conversation.id.includes('@thread.tacv2'))
    return '频道';
  if (type === 'meeting' || conversation.id.includes('meeting_')) return '会议';
  if (conversation.id.includes('@unq.gbl.spaces')) return '私聊';
  if (type === 'chat' || /@thread\.(v2|skype)$/.test(conversation.id)) return '群聊';
  return '其他';
}

/** 页面里 Teams 本地缓存的同步进度：消息链数与最新送达时间，用来判断是否同步完。 */
export const STATS_SCRIPT = String.raw`(async () => {
  if (!/teams\.(cloud\.microsoft|microsoft\.com)$/.test(location.hostname)) return { login: true };
  const all = await indexedDB.databases();
  const name = all.find((d) => d.name && d.name.includes(':replychain-manager:'))?.name;
  if (!name) return { chains: 0, latest: 0 };
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => request.transaction.abort();
  });
  const store = db.transaction('replychains-2', 'readonly').objectStore('replychains-2');
  const chains = await new Promise((resolve) => { const r = store.count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); });
  let latest = 0;
  await new Promise((resolve) => {
    const cursor = db.transaction('replychains-2', 'readonly').objectStore('replychains-2').openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return resolve();
      latest = Math.max(latest, Number(current.value.latestDeliveryTime || 0));
      current.continue();
    };
    cursor.onerror = () => resolve();
  });
  db.close();
  return { chains, latest };
})()`;

export type TeamsMention = '@我' | '回复我';

/** 动态里指向消息的「@我 / 回复我」，按消息 id 索引；点赞等其他动态不要。 */
export function mentionIndex(activities: readonly RawTeamsActivity[]): Map<string, TeamsMention> {
  const index = new Map<string, TeamsMention>();
  for (const activity of activities) {
    if (!activity.messageId) continue;
    if (/mention/i.test(activity.type)) index.set(activity.messageId, '@我');
    else if (/repl/i.test(activity.type) && !index.has(activity.messageId))
      index.set(activity.messageId, '回复我');
  }
  return index;
}
