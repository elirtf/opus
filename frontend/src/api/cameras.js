import { api } from './client'

export const camerasApi = {
  list:   ()           => api.get('/api/cameras/'),
  create: (data)       => api.post('/api/cameras/', data),
  update: (id, data)   => api.patch(`/api/cameras/${id}`, data),
  delete: (id)         => api.delete(`/api/cameras/${id}`),
}