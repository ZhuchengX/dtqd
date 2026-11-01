export function dateLabel(value: string | null, now: Date = new Date()) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        // 不是今年的带年份，免得去年的截止看着像今年的。
        ...(new Date(value).getFullYear() !== now.getFullYear()
          ? { year: 'numeric' as const }
          : {}),
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '无截止日期';
}
