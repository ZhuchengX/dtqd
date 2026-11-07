// Teams dela 命令契约：未登录报 NOT_CONFIGURED、参数二选一、Graph 错误码映射、实时 freshness。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../mail/graph', () => ({
  getTeamsChatType: vi.fn(),
  listTeamsChats: vi.fn(),
  listTeamsChatMessages: vi.fn(),
  listTeamsChannelMessages: vi.fn(),
  listJoinedTeams: vi.fn(),
}));
vi.mock('../../../../mail/microsoft', () => ({ getMicrosoftConfig: vi.fn() }));
vi.mock('electron', () => ({ shell: {} }));
vi.mock('../../../../teams/sync', () => ({
  teamsDirectory: () => '/nonexistent',
  hasTeamsLogin: () => false,
}));
const prefs = vi.hoisted(() => ({ teamsPrivate: false }));
vi.mock('../../../../inbox/prefs', () => ({ inboxPrefs: () => prefs }));

import {
  getTeamsChatType,
  listTeamsChannelMessages,
  listTeamsChatMessages,
  listTeamsChats,
} from '../../../../mail/graph';
import { getMicrosoftConfig } from '../../../../mail/microsoft';
import { MicrosoftAuthError } from '../../../../mail/oauth';
import { teamsTools } from '../index';

const signedIn = {
  clientId: '11111111-2222-3333-4444-555555555555',
  tenant: 'organizations',
  channels: false,
  signedIn: true,
  address: '2400001@dundee.ac.uk',
};

beforeEach(() => {
  vi.resetAllMocks();
  prefs.teamsPrivate = false;
  vi.mocked(getMicrosoftConfig).mockReturnValue(signedIn);
  vi.mocked(getTeamsChatType).mockResolvedValue('group');
});

describe('teams 命令', () => {
  it('注册存档命令和上游 Graph 命令', () => {
    expect(Object.keys(teamsTools).sort()).toEqual([
      'list_teams_archive',
      'list_teams_channels',
      'list_teams_chats',
      'read_teams_archive',
      'read_teams_messages',
      'search_teams_archive',
    ]);
  });

  it('未登录 Microsoft 365 时报 NOT_CONFIGURED，不发请求', async () => {
    vi.mocked(getMicrosoftConfig).mockReturnValue({ ...signedIn, signedIn: false, address: null });
    const error = await Promise.resolve(teamsTools.list_teams_chats.execute({})).catch(
      (cause: unknown) => cause as Error & { code: string },
    );
    expect(error).toMatchObject({ code: 'NOT_CONFIGURED' });
    expect((error as Error).message).toContain('list_teams_archive');
    expect((error as Error).message).not.toContain('Dundee Outlook');
    expect(listTeamsChats).not.toHaveBeenCalled();
  });

  it('list_teams_chats 返回 realtime 新鲜度', async () => {
    vi.mocked(listTeamsChats).mockResolvedValue([]);
    const result = (await teamsTools.list_teams_chats.execute({ limit: 5 })) as {
      freshness: { kind: string };
    };
    expect(listTeamsChats).toHaveBeenCalledWith(5);
    expect(result.freshness.kind).toBe('realtime');
  });

  it('read_teams_messages：chatId 与 teamId+channelId 二选一', () => {
    expect(() => teamsTools.read_teams_messages.execute({})).toThrow();
    expect(() =>
      teamsTools.read_teams_messages.execute({ chatId: 'a', teamId: 't', channelId: 'c' }),
    ).toThrow();
  });

  it('read_teams_messages 透传 cursor 并给出 nextCursor', async () => {
    vi.mocked(listTeamsChatMessages).mockResolvedValue({ items: [], nextLink: 'next' });
    const result = (await teamsTools.read_teams_messages.execute({
      chatId: '19:x',
      cursor: 'prev',
    })) as { nextCursor: string | null };
    expect(listTeamsChatMessages).toHaveBeenCalledWith('19:x', 20, {}, 'prev');
    expect(result.nextCursor).toBe('next');
  });

  it('私聊开关关闭时不列出也不读取一对一聊天，分不清类型的同样处理', async () => {
    const chat = (id: string, chatType: string) => ({ id, chatType }) as never;
    vi.mocked(listTeamsChats).mockResolvedValue([
      chat('g', 'group'),
      chat('m', 'meeting'),
      chat('p', 'oneOnOne'),
      chat('u', 'unknown'),
    ]);
    const listed = (await teamsTools.list_teams_chats.execute({})) as { items: { id: string }[] };
    expect(listed.items.map((item) => item.id)).toEqual(['g', 'm']);

    for (const chatType of ['oneOnOne', 'unknown']) {
      vi.mocked(getTeamsChatType).mockResolvedValue(chatType);
      await expect(teamsTools.read_teams_messages.execute({ chatId: 'p' })).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    }
    expect(listTeamsChatMessages).not.toHaveBeenCalled();
  });

  it('私聊开关打开后可读一对一聊天', async () => {
    prefs.teamsPrivate = true;
    vi.mocked(listTeamsChatMessages).mockResolvedValue({ items: [], nextLink: null });
    await teamsTools.read_teams_messages.execute({ chatId: 'p' });
    expect(getTeamsChatType).not.toHaveBeenCalled();
    expect(listTeamsChatMessages).toHaveBeenCalled();
  });

  it('频道 403 映射为 NOT_CONFIGURED 并保留管理员同意提示', async () => {
    vi.mocked(listTeamsChannelMessages).mockRejectedValue(
      new MicrosoftAuthError('需要学校管理员同意', 'Forbidden'),
    );
    await expect(
      teamsTools.read_teams_messages.execute({ teamId: 't', channelId: 'c' }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED', message: '需要学校管理员同意' });
  });
});
