import type { OutlookWebApi } from '../shared/outlook-web';
import { invoke } from './lib';

export const outlookWeb = {
  getState: () => invoke('outlook-web:state'),
  connect: () => invoke('outlook-web:connect'),
  sync: () => invoke('outlook-web:sync'),
  open: () => invoke('outlook-web:open'),
} satisfies OutlookWebApi;
