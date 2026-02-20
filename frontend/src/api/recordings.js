import { api } from './client'

export const recordingsApi = {
  list:   (camera)  => api.get(`/api/recordings/${camera ? '?camera=' + camera : ''}`),
  toggleRecording: (id, enabled) => api.post(`/api/cameras/${id}/recording`, { enabled }),
}