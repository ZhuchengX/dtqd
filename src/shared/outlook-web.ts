/** 用 Outlook 网页版连接学校邮箱：学生在微软页面自己登录，DTQD 只读收件箱列表。 */
export type OutlookWebStatus = 'ok' | 'needs-login' | 'not-ready' | 'busy';

export interface OutlookWebRow {
  id: string;
  /** Outlook 列表给这一行的完整描述：发件人、主题、时间、预览。 */
  label: string;
  firstSeen: string;
}

export interface OutlookWebState {
  connected: boolean;
  lastSyncAt: string | null;
  lastStatus: OutlookWebStatus | null;
  rows: OutlookWebRow[];
}

export interface OutlookWebApi {
  getState(): Promise<OutlookWebState>;
  /** 打开登录窗口，看到收件箱后自动关闭；学生关掉窗口返回 false。 */
  connect(): Promise<boolean>;
  sync(): Promise<OutlookWebState>;
  /** 打开完整的 Outlook 窗口，读正文和回信都在这里。 */
  open(): Promise<void>;
}
