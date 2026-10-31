// 重要事项偏好：存 workspace_settings 的 inbox-prefs；缺失或损坏回退默认（AI 提取开启、五个兴趣全选）。
import { z } from 'zod';
import { inboxInterestOptions, type InboxPrefs } from '../../shared/inbox';
import { readSetting, writeSetting } from '../settings/prefs';

const KEY = 'inbox-prefs';

export const defaultInboxPrefs: InboxPrefs = {
  aiExtract: true,
  interests: [...inboxInterestOptions],
  noticeAcknowledged: false,
};

const interestSchema = z.string().trim().min(1).max(20);
const prefsSchema = z.object({
  aiExtract: z.boolean(),
  interests: z.array(interestSchema).max(20),
  noticeAcknowledged: z.boolean(),
});

function defaults(): InboxPrefs {
  return { ...defaultInboxPrefs, interests: [...defaultInboxPrefs.interests] };
}

export function inboxPrefs(): InboxPrefs {
  const raw = readSetting(KEY);
  if (raw === undefined) return defaults();
  try {
    return { ...defaults(), ...prefsSchema.partial().parse(JSON.parse(raw)) };
  } catch {
    return defaults();
  }
}

export function setInboxPrefs(patch: unknown): InboxPrefs {
  const next = prefsSchema.parse({ ...inboxPrefs(), ...prefsSchema.partial().parse(patch) });
  writeSetting(KEY, JSON.stringify(next));
  return next;
}
