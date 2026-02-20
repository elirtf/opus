import { api } from './client'

export const healthApi = {
  streams: () => api.get('/api/health/'),
}