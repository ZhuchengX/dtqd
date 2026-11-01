import type { FeedbackApi, FeedbackInput } from '../shared/feedback';
import { invoke } from './lib';

export const feedback = {
  send: (input: FeedbackInput) => invoke('feedback:send', input),
} satisfies FeedbackApi;
