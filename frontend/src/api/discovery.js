import { api } from './client'

export const discoveryApi = {
  scan: (username, password, subnet) =>
    api.post('/api/discovery/scan', { username, password, subnet }),

  add: (group_name, group_display, cameras) =>
    api.post('/api/discovery/add', { group_name, group_display, cameras }),
}