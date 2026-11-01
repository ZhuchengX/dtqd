/** 学生随手反馈：只发学生写的内容、所在页面和软件版本。 */
export const FEEDBACK_MAX_CHARS = 2000;

export interface FeedbackInput {
  text: string;
  /** 反馈时所在的页面，方便定位。 */
  page: string;
}

export interface FeedbackResult {
  /** sent = 已送达后台；queued = 暂存本机，联网后自动补发。 */
  status: 'sent' | 'queued';
}

export interface FeedbackApi {
  send(input: FeedbackInput): Promise<FeedbackResult>;
}
