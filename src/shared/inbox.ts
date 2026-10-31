/** DTQD「重要事项」：把 Teams、Outlook、myDundee 公告与 QQ 收到的文件汇总，用模型挑出对学生本人重要的事进待办。 */
export type InboxSource = 'teams' | 'outlook' | 'mydundee' | 'qq';

export const inboxSourceLabels: Record<InboxSource, string> = {
  teams: 'Teams',
  outlook: 'Outlook',
  mydundee: 'myDundee 公告',
  qq: 'QQ 接收文件',
};

/** 学生可选的兴趣：命中的招聘、讲座、项目信息才算「对我有用」。 */
export const inboxInterestOptions = ['实习', '保研', '竞赛', '出国', '考研'] as const;

export interface InboxPrefs {
  /** 把新消息发给已配置的模型提取待办（默认开启，首次运行时提示一次）。 */
  aiExtract: boolean;
  interests: string[];
  /** 已看过「消息会发给模型」的说明。 */
  noticeAcknowledged: boolean;
}

export type InboxSourceStatusKind =
  'ok' | 'needs-login' | 'not-connected' | 'not-ready' | 'error' | 'idle';

export interface InboxSourceStatus {
  source: InboxSource;
  status: InboxSourceStatusKind;
  lastSyncAt: string | null;
  /** 上次同步读到的新内容条数。 */
  newItems: number;
  detail: string | null;
}

export type InboxRunStatus = 'ok' | 'no-model' | 'failed' | 'off' | 'nothing-new';

export interface InboxRun {
  at: string;
  status: InboxRunStatus;
  /** 判为重要的事项数。 */
  items: number;
  /** 新建的待办数（已建过的不重复）。 */
  todos: number;
  model: string | null;
}

export interface InboxState {
  prefs: InboxPrefs;
  sources: InboxSourceStatus[];
  running: boolean;
  lastRun: InboxRun | null;
  /** 下次自动同步时间。 */
  nextRunAt: string | null;
}

export interface InboxApi {
  getState(): Promise<InboxState>;
  /** 立即同步所有来源并提取；正在同步时返回当前状态。 */
  run(): Promise<InboxState>;
  setPrefs(patch: Partial<InboxPrefs>): Promise<InboxState>;
  onUpdate(listener: (state: InboxState) => void): () => void;
}
