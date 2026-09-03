import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import TopBar from './components/TopBar'
import Toast from './components/Toast'
import Login from './pages/Login'
import Projects from './pages/Projects'
import ProjectSetup from './pages/ProjectSetup'
import Estimation from './pages/Estimation'
import History from './pages/History'
import Aditivas from './pages/Aditivas'
import AditivaForm from './pages/AditivaForm'
import Dashboard from './pages/Dashboard'

function PrivateRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="spinner" />
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {session && <TopBar profile={profile} onSignOut={signOut} />}
      <Toast />
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<PrivateRoute><Projects /></PrivateRoute>} />
        <Route path="/projects/:id/setup" element={<PrivateRoute><ProjectSetup /></PrivateRoute>} />
        <Route path="/projects/:id/estimations/:estId" element={<PrivateRoute><Estimation /></PrivateRoute>} />
        <Route path="/projects/:id/history" element={<PrivateRoute><History /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas" element={<PrivateRoute><Aditivas /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas/new" element={<PrivateRoute><AditivaForm /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas/:adId/edit" element={<PrivateRoute><AditivaForm /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
