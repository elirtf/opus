import { api } from "./client";

export const camerasApi = {
  list: () => api.get("/api/cameras"),
  summary: () => api.get("/api/cameras/summary"),
  inventory: () => api.get("/api/cameras/inventory"),
  source: (id) => api.get(`/api/cameras/${id}/source`),
  status: (name) => api.get(`/api/cameras/${encodeURIComponent(name)}/status`),
  streams: (name) => api.get(`/api/cameras/${encodeURIComponent(name)}/streams`),
  stats: (name) => api.get(`/api/cameras/${encodeURIComponent(name)}/stats`),
  create: (payload) => api.post("/api/cameras", payload),
  update: (id, payload) => api.patch(`/api/cameras/${id}`, payload),
  remove: (id) => api.delete(`/api/cameras/${id}`),
  setRecording: (id, enabled, recordingPolicy) =>
    api.post(`/api/cameras/${id}/recording`, {
      enabled,
      ...(enabled && recordingPolicy ? { recording_policy: recordingPolicy } : {}),
    }),
};