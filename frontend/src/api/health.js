import { api } from './client'

export const healthApi = {
  streams: () => api.get('/api/health/'),
  diagnostics: () => api.get('/api/health/diagnostics'),
  about: () => api.get('/api/health/about'),
}