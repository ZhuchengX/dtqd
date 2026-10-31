import type { SearchApi } from '../shared/api';
import { invoke } from './lib';

export const search = {
  query: (query: string) => invoke('search:query', query),
  openTeamsArchive: (path: string) => invoke('search:open-teams-archive', path),
} satisfies SearchApi;
