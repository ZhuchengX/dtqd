/** Teams 网页版独立窗口（学生自行登录，DTQD 不读取其中内容）。 */
export interface TeamsSyncResult {
  status: 'ok' | 'needs-login' | 'not-ready' | 'busy';
  newMessages: number;
  conversations: number;
  digestPath?: string;
}

/** Teams 与 Outlook 网页版共用一个微软登录。 */
export interface MicrosoftWebConnection {
  connected: boolean;
  /** 本机还有 Teams 存档或读到的邮件列表（断开时可选择保留）。 */
  hasData: boolean;
}

export interface TeamsApi {
  /** 打开 Teams 窗口；已打开则前置。 */
  open(): Promise<void>;
  /** 从 Teams 本地缓存增量同步新消息到 文档/DTQD/teams/。 */
  sync(): Promise<TeamsSyncResult>;
  /** 是否登录过 Teams 或 Outlook 网页版。 */
  connection(): Promise<MicrosoftWebConnection>;
  /** 退出微软登录（Teams 与 Outlook 一起）；deleteData 时同时删除本机存档。已断开时再调用可只删存档。 */
  disconnect(deleteData: boolean): Promise<MicrosoftWebConnection>;
}
