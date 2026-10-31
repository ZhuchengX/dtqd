/** Teams 网页版独立窗口（学生自行登录，DTQD 不读取其中内容）。 */
export interface TeamsApi {
  /** 打开 Teams 窗口；已打开则前置。 */
  open(): Promise<void>;
}
