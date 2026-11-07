import { z } from 'zod';
import { getMailState, listMailFolders } from '../../../mail/api';
import { coverage, freshness, tool, toolError } from '../shared';
import { MAIL_NOT_CONFIGURED } from './not-configured';

export const listMailFoldersTool = tool(
  '列出邮箱的全部文件夹：id、名称、邮件总数、未读数与各自的最近同步时间。只读。search_mail 的 folderId 筛选使用这里返回的 id。',
  z.object({}).strict(),
  async () => {
    const account = getMailState().account;
    if (!account) throw toolError('NOT_CONFIGURED', MAIL_NOT_CONFIGURED);
    const folders = listMailFolders();
    return {
      items: folders,
      freshness: freshness('cached', account.lastSyncedAt),
      coverage: coverage(
        'cached_folders',
        folders.length > 0,
        folders.length ? undefined : ['尚未同步过邮箱，文件夹列表为空'],
      ),
    };
  },
);
