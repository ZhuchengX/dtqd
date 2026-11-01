import type { InboxApi, InboxPrefs, InboxState } from '../shared/api';
import { invoke, on } from './lib';

export const inbox = {
  getState: () => invoke('inbox:get-state'),
  run: () => invoke('inbox:run'),
  loginCampusOffice: () => invoke('inbox:login-campus-office'),
  setPrefs: (patch: Partial<InboxPrefs>) => invoke('inbox:set-prefs', patch),
  onUpdate: (listener: (state: InboxState) => void) => on<InboxState>('inbox:state', listener),
} satisfies InboxApi;
