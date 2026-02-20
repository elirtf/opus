import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CameraView from './pages/CameraView'
import NVRs from './pages/NVRs'
import Cameras from './pages/Cameras'
import Users from './pages/Users'
import Recordings from './pages/Recordings'

function AppLayout({ children, adminOnly = false }) {
  return (
    <ProtectedRoute adminOnly={adminOnly}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"           element={<Login />} />
          <Route path="/"                element={<AppLayout><Dashboard /></AppLayout>} />
          <Route path="/camera/:name"    element={<AppLayout><CameraView /></AppLayout>} />
          <Route path="/recordings"      element={<AppLayout adminOnly><Recordings /></AppLayout>} />
          <Route path="/nvrs"            element={<AppLayout adminOnly><NVRs /></AppLayout>} />
          <Route path="/cameras"         element={<AppLayout adminOnly><Cameras /></AppLayout>} />
          <Route path="/users"           element={<AppLayout adminOnly><Users /></AppLayout>} />
          <Route path="*"                element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}