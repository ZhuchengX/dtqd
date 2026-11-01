import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/api';
import { needsSubmitChecklist } from './submit-checklist';

function todo(title: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'a',
    source: 'canvas',
    title,
    notes: '',
    dueAt: '2026-11-24T12:00:00Z',
    status: 'pending',
    readAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('needsSubmitChecklist', () => {
  it('只在要交东西的待办上显示', () => {
    expect(needsSubmitChecklist(todo('Coursework 1'))).toBe(true);
    expect(needsSubmitChecklist(todo('CW2 report'))).toBe(true);
    expect(needsSubmitChecklist(todo('Class Test 2 - 24/Nov/25'))).toBe(false);
    expect(needsSubmitChecklist(todo('Cyber Resilience and You!'))).toBe(false);
    expect(needsSubmitChecklist(todo('Collaboration workshop'))).toBe(false);
  });

  it('已完成或没有截止时间的不显示', () => {
    expect(needsSubmitChecklist(todo('Essay', { status: 'submitted' }))).toBe(false);
    expect(needsSubmitChecklist(todo('Essay', { dueAt: null }))).toBe(false);
  });
});
