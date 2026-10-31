// 默认工作目录：新用户落在 文档/DTQD，已有上游 文档/Dela 的用户继续沿用旧目录。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ documents: '', saved: undefined as string | undefined }));

vi.mock('electron', () => ({
  app: { getPath: () => state.documents },
}));
vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: () => ({
      get: () => (state.saved === undefined ? undefined : { value: state.saved }),
    }),
  }),
}));

import { storageDirectory } from '../storage';

beforeEach(() => {
  state.documents = mkdtempSync(join(tmpdir(), 'dtqd-storage-'));
  state.saved = undefined;
});

afterEach(() => rmSync(state.documents, { recursive: true, force: true }));

it('新用户默认使用 文档/DTQD', () => {
  expect(storageDirectory()).toBe(join(state.documents, 'DTQD'));
});

it('已存在 文档/Dela 时继续使用旧目录，不迁移', () => {
  mkdirSync(join(state.documents, 'Dela'));
  expect(storageDirectory()).toBe(join(state.documents, 'Dela'));
});

it('已保存的工作目录优先于默认目录', () => {
  mkdirSync(join(state.documents, 'Dela'));
  state.saved = join(state.documents, 'custom');
  expect(storageDirectory()).toBe(join(state.documents, 'custom'));
});
