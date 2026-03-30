import { api } from './client'

export const discoveryApi = {
  /** @deprecated Prefer startScan + pollScan for large subnets */
  scan: (username, password, subnet) =>
    api.post('/api/discovery/scan', { username, password, subnet }),

  startScan: (username, password, subnet) =>
    api.post('/api/discovery/scan/async', { username, password, subnet }),

  scanStatus: (jobId) => api.get(`/api/discovery/scan/status/${encodeURIComponent(jobId)}`),

  add: (group_name, group_display, cameras) =>
    api.post('/api/discovery/add', { group_name, group_display, cameras }),
}