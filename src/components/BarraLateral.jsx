import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { puedeVerDesempeno } from '../lib/desempeno'
import { SECCIONES, GRUPOS } from '../lib/secciones'

/** Barra lateral para saltar entre secciones sin volver al Inicio. Se puede plegar (solo íconos). En el Inicio no sale. */
export default function BarraLateral() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const ruta = pathname.replace(/^\/bea-estimaciones-app/, '') || '/'
  const [veDesempeno, setVeDesempeno] = useState(false)
  const [plegada, setPlegada] = useState(() => { try { return localStorage.getItem('bea_barra_plegada') === '1' } catch { return false } })
  useEffect(() => { if (profile?.email) puedeVerDesempeno().then(setVeDesempeno) }, [profile?.email])
  useEffect(() => { try { localStorage.setItem('bea_barra_plegada', plegada ? '1' : '0') } catch { /* sin almacenamiento */ } }, [plegada])
  if (ruta === '/' || ruta.startsWith('/login')) return null
  const visibles = SECCIONES.filter(s => !s.soloDesempeno || veDesempeno)

  return (
    <aside className={`barra-lat no-print${plegada ? ' plegada' : ''}`} aria-label="Secciones">
      <button className="bl-plegar" onClick={() => setPlegada(!plegada)} aria-label={plegada ? 'Mostrar nombres de las secciones' : 'Plegar la barra'} title={plegada ? 'Mostrar nombres' : 'Plegar'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={plegada ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} /></svg>
      </button>
      <nav>
        {GRUPOS.map(g => {
          const items = visibles.filter(s => s.grupo === g.id)
          if (!items.length) return null
          return (
            <div key={g.id} className={`bl-grupo ${g.id}`}>
              <div className="bl-titulo">{g.nombre}</div>
              {items.map(s => {
                const activa = s.activa(ruta)
                return (
                  <a key={s.ruta} href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${s.ruta}`} className={`bl-item${activa ? ' activa' : ''}`} aria-current={activa ? 'page' : undefined} title={s.nombre}
                    onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(s.ruta) }}>
                    <span className="bl-icono"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={s.icono} /></svg></span>
                    <span className="bl-nombre">{s.nombre}</span>
                  </a>
                )
              })}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
