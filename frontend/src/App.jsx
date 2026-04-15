import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Dashboard from './pages/Dashboard'
import CameraView from './pages/CameraView'
import DeviceSetup from './pages/DeviceSetup'
import Users from './pages/Users'
import Recordings from './pages/Recordings'
import Discovery from './pages/Discovery'
import Configuration from './pages/Configuration'
import PlaybackPage from './pages/playback/PlaybackPage'

function AppLayout({
  children,
  adminOnly = false,
  requireLiveView = false,
  requireRecordingsView = false,
}) {
  return (
    <ProtectedRoute
      adminOnly={adminOnly}
      requireLiveView={requireLiveView}
      requireRecordingsView={requireRecordingsView}
    >
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/setup"           element={<Setup />} />
          <Route path="/login"           element={<Login />} />
          <Route path="/"                element={<AppLayout requireLiveView><Dashboard /></AppLayout>} />
          <Route path="/camera/:name"    element={<AppLayout requireLiveView><CameraView /></AppLayout>} />
          <Route path="/recordings"      element={<AppLayout requireRecordingsView><Recordings /></AppLayout>} />
          <Route path="/playback"        element={<AppLayout requireRecordingsView><PlaybackPage /></AppLayout>} />
          <Route path="/discovery"       element={<AppLayout adminOnly><Discovery /></AppLayout>} />
          <Route path="/devices"         element={<AppLayout adminOnly><DeviceSetup /></AppLayout>} />
          <Route path="/nvrs"            element={<Navigate to="/devices" replace />} />
          <Route path="/cameras"         element={<Navigate to="/devices?tab=cameras" replace />} />
          <Route path="/users"           element={<AppLayout adminOnly><Users /></AppLayout>} />
          <Route path="/configuration"   element={<AppLayout adminOnly><Configuration /></AppLayout>} />
          <Route path="*"                element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}