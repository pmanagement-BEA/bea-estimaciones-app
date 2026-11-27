import { useState } from 'react'
import { aplicarTema, temaGuardado } from '../lib/tema'
import { useLocation, useNavigate } from 'react-router-dom'
import { seccionDe } from '../lib/secciones'

// Barra de arriba sencilla: marca (lleva al Inicio), sección actual, botón de Inicio, tema y usuario.
// Las secciones se abren desde el Inicio (tarjetas).
const Icono = ({ d, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const ICONO_INICIO = 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'
const ICONO_SALIR = 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4'

export default function TopBar({ profile, onSignOut }) {
  const [tema, setTema] = useState(temaGuardado())
  const cambiarTema = () => { const t = tema === 'dark' ? 'light' : 'dark'; aplicarTema(t); setTema(t) }
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const ruta = pathname.replace(/^\/bea-estimaciones-app/, '') || '/'
  const enInicio = ruta === '/'
  const seccion = enInicio ? null : seccionDe(ruta)
  const iniciales = (profile?.nombre || profile?.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  return (
    <header className="topbar tb">
      <button className="tb-marca" onClick={() => navigate('/')} aria-label="Ir al inicio de BEApp">
        <span className="tb-bea">BEA</span><span className="tb-app">App</span>
      </button>
      {seccion && (
        <span className="tb-seccion" aria-current="page"><Icono d={seccion.icono} />{seccion.nombre}</span>
      )}
      <span className="tb-espacio" />
      {!enInicio && (
        <button className="tb-btn tb-inicio" onClick={() => navigate('/')} title="Inicio" aria-label="Ir al inicio">
          <Icono d={ICONO_INICIO} /><span>Inicio</span>
        </button>
      )}
      <button className="tb-btn tb-redondo" onClick={cambiarTema} title={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>{tema === 'dark' ? '☀' : '☾'}</button>
      {profile && (
        <span className="tb-usuario" title={profile.email}>
          <span className="tb-avatar">{iniciales}</span>
          <span className="tb-datos"><span className="tb-nombre">{profile.nombre || profile.email}</span><span className="tb-rol">{profile.role}</span></span>
        </span>
      )}
      <button className="tb-btn" onClick={onSignOut} title="Cerrar sesión"><Icono d={ICONO_SALIR} /><span className="tb-ocultable">Salir</span></button>
    </header>
  )
}
