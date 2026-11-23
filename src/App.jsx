import { useState } from 'react'
import VersionNueva from './components/VersionNueva'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { pideContrasena, supabase } from './lib/supabase'
import CrearContrasena from './pages/CrearContrasena'
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
import Directorio from './pages/Directorio'
import Proyecciones from './pages/Proyecciones'
import ProyeccionesProyecto from './pages/ProyeccionesProyecto'

function PrivateRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="spinner" />
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { session, profile, loading, signOut } = useAuth()

  const [tipoContrasena, setTipoContrasena] = useState(pideContrasena())

  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />
  const temporal = session?.user?.user_metadata?.debe_cambiar_contrasena === true
  if (session && (tipoContrasena || temporal)) {
    return <CrearContrasena tipo={tipoContrasena || 'temporal'} email={session.user?.email}
      onListo={async () => { await supabase.auth.refreshSession(); setTipoContrasena(null) }} />
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {session && <TopBar profile={profile} onSignOut={signOut} />}
      <Toast />
      <VersionNueva />
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<PrivateRoute><Projects /></PrivateRoute>} />
        <Route path="/projects/:id/setup" element={<PrivateRoute><ProjectSetup /></PrivateRoute>} />
        <Route path="/projects/:id/estimations/:estId" element={<PrivateRoute><Estimation /></PrivateRoute>} />
        <Route path="/projects/:id/history" element={<PrivateRoute><History /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/directorio" element={<PrivateRoute><Directorio /></PrivateRoute>} />
        <Route path="/proyecciones" element={<PrivateRoute><Proyecciones /></PrivateRoute>} />
        <Route path="/projects/:id/proyecciones" element={<PrivateRoute><ProyeccionesProyecto /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas" element={<PrivateRoute><Aditivas /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas/new" element={<PrivateRoute><AditivaForm /></PrivateRoute>} />
        <Route path="/projects/:id/aditivas/:adId/edit" element={<PrivateRoute><AditivaForm /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
