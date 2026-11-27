import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useVeDesempeno } from '../hooks/useVeDesempeno'
import { SECCIONES } from '../lib/secciones'

/** Inicio: una tarjeta por sección (ícono, nombre y descripción), en el color de su grupo. */
export default function Inicio() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const veDesempeno = useVeDesempeno(profile?.email)
  const visibles = SECCIONES.filter(s => !s.soloDesempeno || veDesempeno !== false)

  return (
    <div className="inicio">
      <div className="inicio-cab">
        <h1>¿Qué quieres abrir?</h1>
        <p>Elige una herramienta para empezar.</p>
      </div>
      <nav className="inicio-grid" aria-label="Secciones de BEApp">
        {visibles.map(s => (
          <a key={s.ruta} href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${s.ruta}`} className={`inicio-tarjeta ${s.grupo} s${s.ruta.replace('/', '-')}${s.soloDesempeno && veDesempeno == null ? ' pendiente' : ''}`} aria-hidden={s.soloDesempeno && veDesempeno == null ? true : undefined} tabIndex={s.soloDesempeno && veDesempeno == null ? -1 : undefined}
            onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(s.ruta) }}>
            <span className="inicio-icono">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={s.icono} /></svg>
            </span>
            <span className="inicio-nombre">{s.nombre}</span>
            <span className="inicio-desc">{s.desc}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
