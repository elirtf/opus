import { api } from './client'

export const usersApi = {
  list:   ()           => api.get('/api/users/'),
  create: (data)       => api.post('/api/users/', data),
  update: (id, data)   => api.patch(`/api/users/${id}`, data),
  delete: (id)         => api.delete(`/api/users/${id}`),
  getNvrs:    (id)            => api.get(`/api/users/${id}/nvrs`),
  setNvrs:    (id, nvr_ids)   => api.post(`/api/users/${id}/nvrs`, { nvr_ids }),
  getCameras: (id)            => api.get(`/api/users/${id}/cameras`),
  setCameras: (id, camera_ids) => api.post(`/api/users/${id}/cameras`, { camera_ids }),
}