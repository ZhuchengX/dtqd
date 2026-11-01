import privacy from '../../docs/privacy.md?raw';
import terms from '../../docs/terms.md?raw';

/** 正文顶部的「最后更新」就是这一版的版本号。 */
export function revisionOf(markdown: string): string {
  return /最后更新：(\S+)/.exec(markdown)?.[1] ?? 'unknown';
}

export const legalRevisions = {
  terms: revisionOf(terms),
  privacy: revisionOf(privacy),
} as const;
