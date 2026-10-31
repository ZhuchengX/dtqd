/** Teams 网页版独立窗口（学生自行登录，DTQD 不读取其中内容）。 */
export interface TeamsSyncResult {
  status: 'ok' | 'needs-login' | 'not-ready' | 'busy';
  newMessages: number;
  conversations: number;
  digestPath?: string;
}

export interface TeamsApi {
  /** 打开 Teams 窗口；已打开则前置。 */
  open(): Promise<void>;
  /** 从 Teams 本地缓存增量同步新消息到 文档/DTQD/teams/。 */
  sync(): Promise<TeamsSyncResult>;
}
