export interface MailAddress {
  readonly name: string | null;
  readonly address: string | null;
}

export interface MailAttachmentInfo {
  readonly filename: string;
  readonly size: number | null;
  readonly part: string | null;
}

export interface MailFolderInfo {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly total: number | null;
  readonly unread: number | null;
  readonly lastSyncedAt: string | null;
}

export interface MailMessageSummary {
  readonly id: number;
  readonly uid: number;
  readonly subject: string | null;
  readonly sender: MailAddress | null;
  readonly date: string | null;
  readonly seen: boolean;
  readonly flagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string | null;
  readonly size: number | null;
}

export interface MailMessageDetail extends MailMessageSummary {
  readonly folderId?: number;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

/** 回收站条目：本地删除的缓存邮件，附原文件夹名与删除时间。 */
export interface MailTrashItem extends MailMessageSummary {
  readonly folderName: string | null;
  readonly deletedAt: string;
}

/** 本地回收站保留天数；0 表示永久保留。 */
export type MailTrashRetention = 7 | 30 | 90 | 0;

export type MailSyncPhase = 'idle' | 'connecting' | 'syncing' | 'error';

export interface MailSyncStatus {
  readonly phase: MailSyncPhase;
  readonly folderPath: string | null;
  readonly processed: number;
  readonly total: number | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface MailAccountInfo {
  readonly address: string;
  readonly lastSyncedAt: string | null;
}

export interface MailState {
  readonly account: MailAccountInfo | null;
  readonly sync: MailSyncStatus;
}

export type MailResult =
  { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };

/** 邮箱服务器参数：交大邮箱与第三方 IMAP 共用同一套字段，SSL/TLS 固定开启。 */
export interface MailServerConfig {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly smtpHost: string;
  readonly smtpPort: number;
}

/** 交大邮箱预设（学生与教工同一套服务器）；第三方账号由用户自填。 */
export const SJTU_MAIL_SERVER: MailServerConfig = {
  imapHost: 'mail.sjtu.edu.cn',
  imapPort: 993,
  smtpHost: 'mail.sjtu.edu.cn',
  smtpPort: 465,
};

/**
 * Dundee Outlook（Microsoft 365 / Exchange Online）预设：基本认证已被微软禁用，
 * IMAP/SMTP 均走 OAuth2 XOAUTH2。SMTP 用 587 + STARTTLS（不是隐式 TLS 465）。
 */
export const MICROSOFT_MAIL_SERVER: MailServerConfig = {
  imapHost: 'outlook.office365.com',
  imapPort: 993,
  smtpHost: 'smtp.office365.com',
  smtpPort: 587,
};

/** Dundee 学生账号形如 studentID@dundee.ac.uk。 */
export const DUNDEE_MAIL_DOMAIN = 'dundee.ac.uk';

/** Microsoft 365 登录参数：clientId 是维护者在 Azure 注册的应用 ID，不内置任何第三方应用的 ID。 */
export interface MicrosoftLoginInput {
  readonly clientId: string;
  /** 默认 organizations（任意工作/学校账号）；也可填 dundee.ac.uk 或租户 GUID。 */
  readonly tenant?: string;
  /** 额外请求团队频道权限（ChannelMessage.Read.All 需管理员同意）。 */
  readonly channels?: boolean;
}

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
  /** 不传即交大邮箱预设；第三方 IMAP 传自填的服务器参数。 */
  readonly server?: MailServerConfig;
  /** 传入即走 Dundee Outlook（Microsoft 365）OAuth2 登录；此时 password 忽略，address 只作登录提示。 */
  readonly microsoft?: MicrosoftLoginInput;
}

/** 设置里保存的 Microsoft 应用参数（不含任何令牌），供表单回填。 */
export interface MicrosoftConfigView {
  readonly clientId: string;
  readonly tenant: string;
  readonly channels: boolean;
  /** 当前邮箱是否经 Microsoft 365 登录（Teams 能力随之可用）。 */
  readonly signedIn: boolean;
  readonly address: string | null;
}

export interface TeamsChatSummary {
  readonly id: string;
  readonly topic: string | null;
  readonly chatType: string;
  /** 只为没有主题的聊天（多为 1:1）补成员名，用来辨认对方。 */
  readonly members: readonly string[];
  readonly lastUpdatedAt: string | null;
  /** 最后一条消息预览：列表按它的时间排序（lastUpdatedAt 只反映改名/成员变动）。 */
  readonly lastMessage: {
    readonly from: string | null;
    readonly text: string;
    readonly createdAt: string | null;
  } | null;
  readonly webUrl: string | null;
}

export interface TeamsMessage {
  readonly id: string;
  readonly createdAt: string | null;
  readonly from: string | null;
  readonly text: string;
  readonly messageType: string;
  readonly attachments: readonly string[];
  readonly webUrl: string | null;
}

export type MailComposeFileKind = 'attachment' | 'inline';

export interface MailComposeFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: MailComposeFileKind;
  readonly previewUrl: string | null;
}

export interface PreparedEmail {
  id: string;
  to: string[];
  subject: string;
  text: string;
  files: MailComposeFile[];
  html?: string;
  savedLocally?: boolean;
  recipientText?: string;
}

export interface MailDraftInput {
  id?: string;
  account: string;
  recipientText: string;
  subject: string;
  text: string;
  html: string;
  attachmentIds: string[];
  inlineImageIds: string[];
}

export interface MailDraftSummary {
  id: string;
  subject: string;
  recipientText: string;
  updatedAt: string;
}

export interface MailSendInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attachmentIds: readonly string[];
  readonly inlineImageIds: readonly string[];
}

export interface MailApi {
  getState(): Promise<MailState>;
  configure(input: MailConfigureInput): Promise<MailResult>;
  disconnect(): Promise<MailResult>;
  listFolders(): Promise<readonly MailFolderInfo[]>;
  listMessages(folderId: number, limit: number): Promise<readonly MailMessageSummary[]>;
  getMessage(messageId: number): Promise<MailMessageDetail>;
  markSeen(messageId: number): Promise<MailResult>;
  deleteMessage(messageId: number): Promise<MailResult>;
  restoreMessage(messageId: number): Promise<MailResult>;
  purgeMessage(messageId: number): Promise<MailResult>;
  emptyTrash(): Promise<MailResult>;
  listTrash(): Promise<readonly MailTrashItem[]>;
  getTrashRetention(): Promise<MailTrashRetention>;
  setTrashRetention(retention: MailTrashRetention): Promise<MailTrashRetention>;
  downloadAttachment(messageId: number, part: string): Promise<MailResult>;
  pickComposeFiles(kind: MailComposeFileKind): Promise<readonly MailComposeFile[]>;
  addComposeImage(dataUrl: string): Promise<MailComposeFile>;
  releaseComposeFiles(ids: readonly string[]): Promise<void>;
  sendMessage(input: MailSendInput): Promise<MailResult>;
  openDraft(id: string): Promise<PreparedEmail>;
  saveDraft(input: MailDraftInput): Promise<MailDraftSummary>;
  listDrafts(account: string): Promise<MailDraftSummary[]>;
  deleteDraft(id: string): Promise<void>;
  confirmDraftClose(): Promise<'save' | 'discard' | 'cancel'>;
  setComposeActive(active: boolean): Promise<void>;
  onRequestClose(listener: (quitting: boolean) => void): () => void;
  syncNow(): Promise<void>;
  onSyncStatus(listener: (status: MailSyncStatus) => void): () => void;
  /** Dundee Outlook：读取已保存的 Azure 应用参数与登录状态。 */
  getMicrosoftConfig(): Promise<MicrosoftConfigView>;
  /** Teams（Microsoft Graph，只读）：最近聊天列表。 */
  listTeamsChats(limit?: number): Promise<readonly TeamsChatSummary[]>;
  /** Teams（Microsoft Graph，只读）：某个聊天的最近消息。 */
  listTeamsMessages(chatId: string, limit?: number): Promise<readonly TeamsMessage[]>;
}
