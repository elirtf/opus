import { api } from './client'

export const authApi = {
  login: (username, password) => api.post('/api/auth/login', { username, password }),
  logout: () => api.post('/api/auth/logout'),
  me: () => api.get('/api/auth/me'),
  /** Returns { needs_setup: boolean } */
  setupStatus: () => api.get('/api/auth/setup'),
  setup: (body) => api.post('/api/auth/setup', body),
}
