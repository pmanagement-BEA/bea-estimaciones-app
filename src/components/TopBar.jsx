import { useEffect, useState } from 'react'
import { puedeVerDesempeno } from '../lib/desempeno'
import { aplicarTema, temaGuardado } from '../lib/tema'
import { useLocation, useNavigate } from 'react-router-dom'

// Íconos de línea (24×24, trazo 2), heredan el color del texto
const I = {
  proyectos: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  dashboard: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  proyecciones: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  directorio: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></>,
  checador: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></>,
  track: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  reportecx: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6" /><path d="M10 17h4" /></>,
  desempeno: <><circle cx="12" cy="12" r="9" /><path d="M12 12l5-3" /><path d="M12 3v2" /><path d="M3 12h2" /><path d="M19 12h2" /></>,
  salir: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l4-4-4-4" /><path d="M14 12H4" /></>,
}
const Icono = ({ n }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>
)

const NAV = [
  ['/', 'proyectos', 'Estimaciones', p => p === '/' || p.startsWith('/projects')],
  ['/dashboard', 'dashboard', 'Dashboard', p => p.startsWith('/dashboard')],
  ['/proyecciones', 'proyecciones', 'Proyecciones', p => p.startsWith('/proyecciones')],
  ['/checador', 'checador', 'Checador', p => p.startsWith('/checador')],
  ['/track', 'track', 'Track', p => p.startsWith('/track')],
  ['/reporte-cx', 'reportecx', 'Reporte Cx', p => p.startsWith('/reporte-cx')],
  ['/desempeno', 'desempeno', 'Desempeño', p => p.startsWith('/desempeno'), false, true],
  ['/directorio', 'directorio', 'Directorio', p => p.startsWith('/directorio')],
]

export default function TopBar({ profile, onSignOut }) {
  const [tema, setTema] = useState(temaGuardado())
  const [veDesempeno, setVeDesempeno] = useState(false)
  useEffect(() => { if (profile?.email) puedeVerDesempeno().then(setVeDesempeno) }, [profile?.email])
  const cambiarTema = () => { const t = tema === 'dark' ? 'light' : 'dark'; aplicarTema(t); setTema(t) }
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const ruta = pathname.replace(/^\/bea-estimaciones-app/, '') || '/'
  const iniciales = (profile?.nombre || profile?.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  return (
    <div className="topbar">
      <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}bea_logo_blanco.png`} alt="BEA · Bioconstrucción y Energía Alternativa" />
        <img className="brand-simbolo" src={`${import.meta.env.BASE_URL}bea_simbolo_blanco.png`} alt="BEA" />
        <span className="brand-sub">BEApp</span>
      </div>
      <nav className="topbar-nav" aria-label="Secciones">
        {NAV.filter(n => !n[5] || veDesempeno).map(([to, icono, texto, activo, enObra]) => (
          <button key={to} className={`nav-btn${activo(ruta) ? ' activo' : ''}`} onClick={() => navigate(to)} aria-current={activo(ruta) ? 'page' : undefined}>
            <Icono n={icono} /><span>{texto}</span>{enObra && <span className="nav-obra" title="En construcción" aria-label="En construcción">🚧</span>}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <button className="tema-btn" onClick={cambiarTema} title={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>{tema === 'dark' ? '☀' : '☾'}</button>
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
