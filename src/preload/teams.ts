import type { TeamsApi } from '../shared/api';
import { invoke } from './lib';

export const teams = {
  open: () => invoke('teams:open'),
  sync: () => invoke('teams:sync'),
  connection: () => invoke('teams:connection'),
  disconnect: (deleteData) => invoke('teams:disconnect', deleteData),
} satisfies TeamsApi;
