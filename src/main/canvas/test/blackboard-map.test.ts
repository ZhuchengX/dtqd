import { describe, expect, it } from 'vitest';
import type { SourceItem } from '../../../shared/api';
import {
  announcementSource,
  blackboardNextPage,
  blackboardNumericId,
  blackboardSubmission,
  blackboardTerm,
  contentKind,
  embeddedFiles,
  gradeColumnAssignments,
  mapContent,
  schoolSites,
  type BlackboardSource,
} from '../blackboard-map';
import { canvasTodoStatus } from '../../../shared/todo';

describe('blackboardNumericId', () => {
  it('取 _数字_1 的中间数字，其余格式返回 0', () => {
    expect(blackboardNumericId('_12345_1')).toBe(12345);
    expect(blackboardNumericId('AC21007')).toBe(0);
  });
});

describe('blackboardNextPage', () => {
  it('跟随同源分页，拒绝外部地址', () => {
    expect(
      blackboardNextPage({ paging: { nextPage: '/learn/api/public/v1/courses?offset=100' } }),
    ).toBe('https://my.dundee.ac.uk/learn/api/public/v1/courses?offset=100');
    expect(blackboardNextPage({ results: [] })).toBeNull();
    expect(() => blackboardNextPage({ paging: { nextPage: 'https://evil.example/x' } })).toThrow();
  });
});

describe('contentKind', () => {
  it('按 contentHandler 归类', () => {
    const kind = (id: string) => contentKind({ contentHandler: { id } });
    expect(kind('resource/x-bb-folder')).toBe('folder');
    expect(kind('resource/x-bb-lesson')).toBe('folder');
    expect(kind('resource/x-bb-file')).toBe('file');
    expect(kind('resource/x-bb-document')).toBe('document');
    expect(kind('resource/x-bb-externallink')).toBe('link');
    expect(kind('resource/x-bb-asmt-test-link')).toBe('assignment');
    expect(contentKind({ contentHandler: { id: 'resource/x-unknown' }, hasChildren: true })).toBe(
      'folder',
    );
  });
});

describe('embeddedFiles', () => {
  it('提取正文中站内 bbcswebdav 文件链接并去重，忽略外站', () => {
    const html =
      '<a href="https://my.dundee.ac.uk/bbcswebdav/pid-1/xid-2_1/Week%201.pdf">W1</a>' +
      '<a href="/bbcswebdav/pid-1/xid-2_1/Week%201.pdf">dup</a>' +
      '<img src="https://cdn.example/bbcswebdav/x.png">';
    expect(embeddedFiles(html)).toEqual([
      {
        url: 'https://my.dundee.ac.uk/bbcswebdav/pid-1/xid-2_1/Week%201.pdf',
        name: 'Week 1.pdf',
      },
    ]);
  });
});

describe('mapContent', () => {
  it('文件夹返回条目 id，文件生成下载资料，文档带正文与内嵌文件，作业挂截止时间', () => {
    const items: SourceItem[] = [];
    const sources = new Map<string, BlackboardSource>();
    const due = new Map([['_30_1', '2026-11-20T23:59:00.000Z']]);
    const run = (content: Record<string, unknown>, attachments: Record<string, unknown>[] = []) =>
      mapContent(7, '_7_1', { content, parentId: '7:files', attachments }, due, items, sources);

    expect(
      run({ id: '_10_1', title: 'Week 1', contentHandler: { id: 'resource/x-bb-folder' } }),
    ).toBe('bb:_10_1');
    run({ id: '_11_1', title: 'Slides', contentHandler: { id: 'resource/x-bb-file' } }, [
      { id: '_99_1', fileName: 'lec1.pdf', mimeType: 'application/pdf' },
    ]);
    run({
      id: '_12_1',
      title: 'Reading',
      contentHandler: { id: 'resource/x-bb-document' },
      body: '<a href="/bbcswebdav/pid-3/notes.pdf">notes</a>',
    });
    run({
      id: '_30_1',
      title: 'Coursework 1',
      contentHandler: { id: 'resource/x-bb-asmt-test-link' },
    });

    const file = sources.get('bbfile:_7_1:_11_1:_99_1');
    expect(file?.downloadUrl).toBe(
      'https://my.dundee.ac.uk/learn/api/public/v1/courses/_7_1/contents/_11_1/attachments/_99_1/download',
    );
    expect(sources.get('bb:_7_1:_12_1')?.kind).toBe('page');
    expect([...sources.keys()]).toContain(
      'bbembed:_7_1:https://my.dundee.ac.uk/bbcswebdav/pid-3/notes.pdf',
    );
    expect(items.find((item) => item.id === 'bb:_30_1')).toMatchObject({
      kind: 'assignment',
      dueAt: '2026-11-20T23:59:00.000Z',
    });
  });
});

describe('gradeColumnAssignments', () => {
  it('只有带截止时间的成绩列算作业', () => {
    const { assignments, dueByContent } = gradeColumnAssignments([
      { id: '_1_1', name: 'CW1', contentId: '_30_1', grading: { due: '2026-11-20T23:59:00Z' } },
      { id: '_2_1', name: 'Total', grading: { type: 'Calculated' } },
    ]);
    expect(assignments.map((a) => a.name)).toEqual(['CW1']);
    expect(dueByContent.get('_30_1')).toBe('2026-11-20T23:59:00Z');
  });
});

describe('blackboardSubmission', () => {
  it('映射为 TODO 可识别的提交状态', () => {
    const status = (grade?: Record<string, unknown>) =>
      canvasTodoStatus({ submission: blackboardSubmission(grade) });
    expect(status({ status: 'Graded', score: 70 })).toBe('graded');
    expect(status({ status: 'NeedsGrading' })).toBe('submitted');
    expect(status(undefined)).toBe('unknown');
  });
});

describe('blackboardTerm', () => {
  it('模块名里的 SEM 换成中南学期键，其次 terms 名称与课程名里的学年', () => {
    expect(blackboardTerm('2025-26', { name: 'DI41011 - Graph Theory ( SEM 1 25/26 )' })).toBe(
      '2025-2026-1',
    );
    expect(blackboardTerm('', { name: 'DI42005 - Mathematical Biology II ( SEM 2 25/26 )' })).toBe(
      '2025-2026-2',
    );
    expect(blackboardTerm('', { name: 'DI40001 - Honours Project ( SEM 1-2 25/26 )' })).toBe(
      '2025-2026 全学年',
    );
    expect(blackboardTerm('', { name: 'DI22013 - Statistics II ( SEM 2 2023 )' })).toBe(
      '2022-2023-2',
    );
    expect(blackboardTerm('', { name: 'DI11002 - English II ( SEM 12 22/23 )' })).toBe(
      '2022-2023 全学年',
    );
    expect(blackboardTerm('2025-26', { name: 'DI99999 - Statistics' })).toBe('2025-2026 学年');
    expect(blackboardTerm('Open Term', { name: 'DI99999 - No year' })).toBe('Open Term');
  });

  it('没有模块代码的学校站点不归学期', () => {
    expect(
      blackboardTerm('2026-27', { name: 'Information Security Awareness Training 2026/27' }),
    ).toBe('未标注学期');
    expect(blackboardTerm('', { name: 'Careers Service' })).toBe('未标注学期');
  });
});

describe('学校站点公告', () => {
  it('只挑未标注学期、未归档、有外部 id 的站点', () => {
    const site = { id: 1, term: '未标注学期', externalId: '_1_1', archived: false };
    const module = { id: 2, term: '2025-2026', externalId: '_2_1', archived: false };
    const hidden = { id: 3, term: '未标注学期', externalId: '_3_1', archived: true };
    const local = { id: 4, term: '未标注学期', archived: false };
    expect(schoolSites([site, module, hidden, local])).toEqual([site]);
  });

  it('公告转成 bbann: 开头的资料，重要事项靠这个前缀读取', () => {
    const source = announcementSource(66821, '_66821_1', {
      id: '_9_1',
      title: 'Careers fair',
      body: '<p>hi</p>',
      created: '2026-10-20T00:00:00Z',
    });
    expect(source).toMatchObject({
      id: 'bbann:_66821_1:_9_1',
      courseId: 66821,
      title: 'Careers fair',
      kind: 'discussion',
      updatedAt: '2026-10-20T00:00:00Z',
    });
  });
});
