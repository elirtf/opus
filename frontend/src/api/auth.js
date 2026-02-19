import { api } from './client'

export const authApi = {
  login:  (username, password) => api.post('/api/auth/login', { username, password }),
  logout: ()                   => api.post('/api/auth/logout'),
  me:     ()                   => api.get('/api/auth/me'),
}