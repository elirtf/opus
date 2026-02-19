import { api } from './client'

export const nvrsApi = {
  list:   ()           => api.get('/api/nvrs/'),
  create: (data)       => api.post('/api/nvrs/', data),
  update: (id, data)   => api.patch(`/api/nvrs/${id}`, data),
  delete: (id)         => api.delete(`/api/nvrs/${id}`),
  sync:   (id)         => api.post(`/api/nvrs/${id}/sync`),
}