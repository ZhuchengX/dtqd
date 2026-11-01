import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, ipcMain: { handle: vi.fn() } }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../settings/prefs', () => ({ readSetting: vi.fn() }));
import { feedbackMessage, flushFeedback } from '..';

const item = (text: string) => ({
  text,
  page: '课表',
  version: '1.0',
  at: '2026-11-01T04:00:00.000Z',
});

describe('feedback', () => {
  it('消息带时间、页面、版本和原文', () => {
    expect(feedbackMessage(item('课表不对'))).toBe(
      '【学生反馈】2026-11-01 04:00 UTC · 课表 · v1.0\n课表不对',
    );
  });

  it('全部发出后队列为空', async () => {
    expect(await flushFeedback([item('a'), item('b')], async () => true)).toEqual([]);
  });

  it('发送失败就停下，保留没发出去的', async () => {
    const post = vi.fn(async () => post.mock.calls.length < 2);
    expect(await flushFeedback([item('a'), item('b'), item('c')], post)).toEqual([
      item('b'),
      item('c'),
    ]);
  });
});
