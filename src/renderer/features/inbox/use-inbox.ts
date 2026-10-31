// 重要事项状态：读一次主进程状态并订阅 inbox:state 广播；浏览器预览没有 preload 时为 null。
import { useEffect, useState } from 'react';
import type { InboxRunStatus, InboxSourceStatusKind, InboxState } from '../../../shared/api';

export function useInboxState(): InboxState | null {
  const [state, setState] = useState<InboxState | null>(null);
  useEffect(() => {
    const inbox = window.dela?.inbox;
    if (!inbox) return;
    let active = true;
    void inbox.getState().then((value) => {
      if (active) setState(value);
    });
    const unsubscribe = inbox.onUpdate((value) => setState(value));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}

export const sourceStatusLabels: Record<InboxSourceStatusKind, string> = {
  ok: '正常',
  'needs-login': '需要重新登录',
  'not-connected': '未连接',
  'not-ready': '未加载完',
  error: '出错',
  idle: '等待同步',
};

export const runStatusLabels: Record<InboxRunStatus, string> = {
  ok: '已提取',
  'no-model': '没配模型，新消息已留着，配好后自动提取',
  failed: '提取失败，下次自动重试',
  off: 'AI 提取已关闭，新消息已留着',
  'nothing-new': '没有新消息',
};

/** 「刚刚 / 12 分钟前 / 3 小时前 / 10-30 14:05」。 */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return '从未';
  const diff = now - Date.parse(iso);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
