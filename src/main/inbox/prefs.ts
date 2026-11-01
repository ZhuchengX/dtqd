// 重要事项偏好：缺失或损坏回退默认。AI 提取和校内办公网默认关闭，都要学生自己打开。
import { z } from 'zod';
import { inboxInterestOptions, type InboxPrefs } from '../../shared/inbox';
import { readSetting, writeSetting } from '../settings/prefs';

// v2：旧版默认开启 AI 提取，不算学生明确同意，升级后重新询问。
const KEY = 'inbox-prefs-v2';

export const defaultInboxPrefs: InboxPrefs = {
  aiExtract: false,
  interests: [...inboxInterestOptions],
  noticeAcknowledged: false,
  sources: { teams: true, outlook: true, mydundee: true, campus: true, qq: true },
  teamsPrivate: false,
  backgroundSync: true,
  officeNetwork: false,
};

const interestSchema = z.string().trim().min(1).max(20);
const prefsSchema = z.object({
  aiExtract: z.boolean(),
  interests: z.array(interestSchema).max(20),
  noticeAcknowledged: z.boolean(),
  sources: z.object({
    teams: z.boolean(),
    outlook: z.boolean(),
    mydundee: z.boolean(),
    campus: z.boolean(),
    qq: z.boolean(),
  }),
  teamsPrivate: z.boolean(),
  backgroundSync: z.boolean(),
  officeNetwork: z.boolean(),
});

function defaults(): InboxPrefs {
  return {
    ...defaultInboxPrefs,
    interests: [...defaultInboxPrefs.interests],
    sources: { ...defaultInboxPrefs.sources },
  };
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
