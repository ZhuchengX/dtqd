import { describe, expect, it } from 'vitest';
import { deepseekFlashModel, llmProviderPresets } from './llm-presets';

describe('deepseekFlashModel', () => {
  it('新旧两种 flash 名字都认，别家模型不算', () => {
    expect(deepseekFlashModel(['deepseek-v4-pro', 'deepseek-flash'])).toBe('deepseek-flash');
    expect(deepseekFlashModel(['deepseek-v4-pro', 'deepseek-v4-flash'])).toBe('deepseek-v4-flash');
    expect(deepseekFlashModel(['gemini-flash', 'deepseek-v4-pro'])).toBeUndefined();
  });

  it('DeepSeek 预设把 flash 排第一', () => {
    const preset = llmProviderPresets.find(({ id }) => id === 'deepseek');
    expect(preset?.models[0]).toBe('deepseek-flash');
  });
});
