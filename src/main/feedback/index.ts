// 随手反馈：发到团队飞书群机器人；发不出去（没配置、没网）就暂存本机，下次发送时补发。
import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FEEDBACK_MAX_CHARS, type FeedbackResult } from '../../shared/feedback';
import { checkWorkspaceSender } from '../ipc';
import { readSetting } from '../settings/prefs';

const inputSchema = z.object({
  text: z.string().trim().min(1).max(FEEDBACK_MAX_CHARS),
  page: z.string().max(40),
});
declare const __FEEDBACK_WEBHOOK__: string | undefined;

const WEBHOOK_SETTING = 'feedback-webhook';
/** 本机设置优先（方便换群），否则用打包时写入的地址，学生不用配置。 */
const BUILT_IN_WEBHOOK = typeof __FEEDBACK_WEBHOOK__ === 'string' ? __FEEDBACK_WEBHOOK__ : '';
const REQUEST_TIMEOUT_MS = 10_000;

export interface QueuedFeedback {
  text: string;
  page: string;
  version: string;
  at: string;
}

export function feedbackMessage(item: QueuedFeedback): string {
  return `【学生反馈】${item.at.slice(0, 16).replace('T', ' ')} UTC · ${item.page} · v${item.version}\n${item.text}`;
}

/** 依次发送，遇到第一次失败就停（多半是没网），返回还没发出去的。 */
export async function flushFeedback(
  queue: readonly QueuedFeedback[],
  post: (message: string) => Promise<boolean>,
): Promise<QueuedFeedback[]> {
  for (const [index, item] of queue.entries()) {
    if (!(await post(feedbackMessage(item)))) return queue.slice(index);
  }
  return [];
}

function queuePath(): string {
  return join(app.getPath('userData'), 'feedback-queue.json');
}

function readQueue(): QueuedFeedback[] {
  try {
    return existsSync(queuePath())
      ? (JSON.parse(readFileSync(queuePath(), 'utf8')) as QueuedFeedback[])
      : [];
  } catch (error) {
    console.error('[feedback] 暂存读取失败', error instanceof Error ? error.message : '');
    return [];
  }
}

async function postToWebhook(message: string): Promise<boolean> {
  const webhook = readSetting(WEBHOOK_SETTING) || BUILT_IN_WEBHOOK;
  if (!webhook) return false;
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: message } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json()) as { code?: number };
    return response.ok && (body.code ?? 0) === 0;
  } catch (error) {
    console.error('[feedback] 发送失败', error instanceof Error ? error.message : '');
    return false;
  }
}

async function sendFeedback(input: unknown): Promise<FeedbackResult> {
  const { text, page } = inputSchema.parse(input);
  const item = { text, page, version: app.getVersion(), at: new Date().toISOString() };
  const remaining = await flushFeedback([...readQueue(), item], postToWebhook);
  writeFileSync(queuePath(), JSON.stringify(remaining), { mode: 0o600 });
  return { status: remaining.length === 0 ? 'sent' : 'queued' };
}

export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:send', (event, input: unknown) => {
    checkWorkspaceSender(event);
    return sendFeedback(input);
  });
}
