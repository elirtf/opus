import { api } from './client'

export const go2rtcApi = {
  getSettings: () => api.get('/api/go2rtc/settings'),
  updateSettings: (body) => api.put('/api/go2rtc/settings', body),
}
