import { createContext, useContext, useState, useEffect } from 'react'
import { authApi } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)   // null = not loaded yet
  const [loading, setLoading] = useState(true)   // checking session on mount

  // On first load, check if we already have a valid session
  useEffect(() => {
    authApi.me()
      .then(setUser)
      .catch(() => setUser(false)) // false = definitely not logged in
      .finally(() => setLoading(false))
  }, [])

  async function login(username, password) {
    const userData = await authApi.login(username, password)
    setUser(userData)
    return userData
  }

  async function logout() {
    await authApi.logout().catch(() => {})
    setUser(false)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}