// 提交前检查清单：只在像「要交东西」的未完成待办上显示；勾选状态存本机（只是便利，丢了不影响什么）。
import type { TodoItem } from '../../../shared/api';
import { todoCompleted } from '../../../shared/todo';

export const submitChecklist = [
  '再读一遍作业要求和评分标准（rubric）',
  '字数、页数在要求范围内',
  '引用格式统一（按课程要求，常见 Harvard）',
  '文件格式、文件名按要求（PDF / Word、学号姓名）',
  '有 Turnitin 的留出看相似度报告的时间',
  '提交后在平台上看到回执或确认邮件',
] as const;

const SUBMIT_WORDS =
  /作业|提交|报告|论文|assignment|coursework|essay|report|submission|submit|lab|project|portfolio/i;

export function needsSubmitChecklist(item: TodoItem): boolean {
  if (todoCompleted(item.status) || !item.dueAt) return false;
  return item.source === 'canvas' || SUBMIT_WORDS.test(item.title);
}

const storageKey = (id: string) => `dtqd-submit-checklist:${id}`;

export function readChecked(id: string): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value) => Number.isInteger(value)) : [];
  } catch {
    return [];
  }
}

export function writeChecked(id: string, checked: readonly number[]): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(checked));
  } catch {
    // 隐私模式或存储被禁时只是不记住勾选。
  }
}
