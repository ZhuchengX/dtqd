import { z } from 'zod';
import { defaultChatFileRoots, listChatFiles } from '../../../chatfiles/scan';
import { limit, offset, page, query, tool, type AgentTool } from '../shared';

const listChatFilesTool = tool(
  '列出本机 QQ / 微信「接收文件」目录里收到的文件（群里老师/辅导员发的课件、通知、表格等），按修改时间倒序。只读文件列表，不读聊天记录。拿到 path 后用 read 或 document-reading Skill 读正文，用 shell 复制进项目。',
  z
    .object({
      app: z.enum(['qq', 'wechat', 'all']).default('all'),
      days: z.number().int().min(1).max(365).default(14),
      query,
      offset,
      limit,
    })
    .strict(),
  async ({ app, days, query, offset, limit }) => {
    const roots = (await defaultChatFileRoots()).filter(
      (root) => app === 'all' || root.app === app,
    );
    const files = await listChatFiles(roots, {
      sinceMs: Date.now() - days * 86_400_000,
      query,
    });
    return { roots, ...page(files, offset, limit) };
  },
);

export const chatfilesTools = {
  list_chat_files: listChatFilesTool,
} satisfies Record<string, AgentTool>;
