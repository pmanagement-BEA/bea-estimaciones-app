import { useLocation, useNavigate } from 'react-router-dom'

// Íconos de línea (24×24, trazo 2), heredan el color del texto
const I = {
  proyectos: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  dashboard: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  proyecciones: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  directorio: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></>,
  salir: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l4-4-4-4" /><path d="M14 12H4" /></>,
}
const Icono = ({ n }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>
)

const NAV = [
  ['/', 'proyectos', 'Proyectos', p => p === '/' || p.startsWith('/projects')],
  ['/dashboard', 'dashboard', 'Dashboard', p => p.startsWith('/dashboard')],
  ['/proyecciones', 'proyecciones', 'Proyecciones', p => p.startsWith('/proyecciones')],
  ['/directorio', 'directorio', 'Directorio', p => p.startsWith('/directorio')],
]

export default function TopBar({ profile, onSignOut }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const ruta = pathname.replace(/^\/bea-estimaciones-app/, '') || '/'
  const iniciales = (profile?.nombre || profile?.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  return (
    <div className="topbar">
      <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <span className="brand-mark">BEA</span>
        <span className="brand-sub">Estimaciones de Proyectos</span>
      </div>
      <nav className="topbar-nav" aria-label="Secciones">
        {NAV.map(([to, icono, texto, activo]) => (
          <button key={to} className={`nav-btn${activo(ruta) ? ' activo' : ''}`} onClick={() => navigate(to)} aria-current={activo(ruta) ? 'page' : undefined}>
            <Icono n={icono} /><span>{texto}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        {profile && (
          <div className="usuario" title={profile.email}>
            <span className="avatar">{iniciales}</span>
            <span className="usuario-datos">
              <span className="usuario-nombre">{profile.nombre || profile.email}</span>
              <span className="usuario-rol">{profile.role}</span>
            </span>
          </div>
        )}
        <button className="nav-btn salir" onClick={onSignOut} title="Cerrar sesión"><Icono n="salir" /><span>Salir</span></button>
      </div>
    </div>
  )
}
