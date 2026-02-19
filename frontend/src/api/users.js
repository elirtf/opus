import { api } from './client'

export const usersApi = {
  list:   ()           => api.get('/api/users/'),
  create: (data)       => api.post('/api/users/', data),
  update: (id, data)   => api.patch(`/api/users/${id}`, data),
  delete: (id)         => api.delete(`/api/users/${id}`),
}