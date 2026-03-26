import { api } from './client'

export const recordingsApi = {
  list:   (camera)  => api.get(`/api/recordings/${camera ? '?camera=' + camera : ''}`),
  toggleRecording: (id, enabled, recordingPolicy) =>
    api.post(`/api/cameras/${id}/recording`, {
      enabled,
      ...(enabled && recordingPolicy ? { recording_policy: recordingPolicy } : {}),
    }),
}