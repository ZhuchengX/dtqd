import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultChatFileRoots, listChatFiles } from '../scan';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'dtqd-chatfiles-'));
  const qq = join(home, 'Library/Containers/com.tencent.qq/Data/Downloads');
  const wechat = join(
    home,
    'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_a/msg/file/2026-10',
  );
  mkdirSync(qq, { recursive: true });
  mkdirSync(wechat, { recursive: true });
  mkdirSync(join(qq, 'Thumb'));
  writeFileSync(join(qq, '期末考试安排.xlsx'), 'x');
  writeFileSync(join(qq, 'Thumb', 'a.jpg'), 'x');
  writeFileSync(join(qq, '.DS_Store'), 'x');
  writeFileSync(join(wechat, 'Week5 slides.pdf'), 'xx');
  const old = join(wechat, 'old.pdf');
  writeFileSync(old, 'x');
  utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
  return home;
}

describe('chat file scan', () => {
  it('找到 macOS 上 QQ 与微信的接收目录', async () => {
    const home = fixture();
    const roots = await defaultChatFileRoots('darwin', home);
    expect(roots.map((root) => root.app)).toEqual(['qq', 'wechat']);
  });

  it('跳过缩略图与隐藏文件，按时间过滤与关键词搜索', async () => {
    const home = fixture();
    const roots = await defaultChatFileRoots('darwin', home);
    const recent = await listChatFiles(roots, { sinceMs: Date.parse('2025-01-01') });
    expect(recent.map((file) => file.name).sort()).toEqual([
      'Week5 slides.pdf',
      '期末考试安排.xlsx',
    ]);
    const found = await listChatFiles(roots, { query: '考试' });
    expect(found.map((file) => [file.app, file.name])).toEqual([['qq', '期末考试安排.xlsx']]);
  });

  it('Windows 路径不存在时返回空', async () => {
    expect(await defaultChatFileRoots('win32', mkdtempSync(join(tmpdir(), 'dtqd-win-')))).toEqual(
      [],
    );
  });
});
