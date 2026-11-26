import { useEffect, useMemo, useState } from 'react'
import { cargarActividades, cargarConceptos } from '../lib/track'

export const sinAcentos = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// ── Buscador de proyecto (escribe clave, nombre o cliente) ──
export function BuscadorProyecto({ proyectos, valor, alElegir, placeholder = 'Proyecto (clave, nombre o cliente)…' }) {
  const [txt, setTxt] = useState('')
  const [abierto, setAbierto] = useState(false)
  const elegido = proyectos.find(p => p.id === valor)
  const lista = useMemo(() => {
    const q = sinAcentos(txt)
    const activos = proyectos.filter(p => p.activo)
    if (!q) return activos.slice(0, 40)
    return activos.filter(p => sinAcentos(`${p.nombre} ${p.cliente}`).includes(q)).slice(0, 40)
  }, [txt, proyectos])
  return (
    <div className="buscador-trk">
      <input
        value={abierto ? txt : (elegido?.nombre || '')}
        placeholder={placeholder}
        onFocus={() => { setAbierto(true); setTxt('') }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={e => setTxt(e.target.value)}
        aria-label="Proyecto"
      />
      {abierto && (
        <ul className="opciones-trk" role="listbox">
          {lista.length === 0 && <li className="vacio">Sin coincidencias</li>}
          {lista.map(p => (
            <li key={p.id} role="option" aria-selected={p.id === valor} onMouseDown={() => { alElegir(p); setAbierto(false) }}>
              <span className="nom">{p.nombre}</span><span className="cli">{p.cliente}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Actividades de Toggl del proyecto + conceptos de su estimación (si está ligado a la app). */
export function useOpciones(proyecto) {
  const [ops, setOps] = useState({ actividades: [], conceptos: [] })
  useEffect(() => {
    if (!proyecto) { setOps({ actividades: [], conceptos: [] }); return }
    let vivo = true
    Promise.all([cargarActividades(proyecto.id), cargarConceptos(proyecto.project_id)])
      .then(([a, c]) => vivo && setOps({ actividades: a.filter(x => x.activo), conceptos: c }))
      .catch(() => vivo && setOps({ actividades: [], conceptos: [] }))
    return () => { vivo = false }
  }, [proyecto?.id])
  return ops
}

export function SelectorActividad({ ops, valor, alCambiar }) {
  return (
    <select value={valor} onChange={e => alCambiar(e.target.value)} aria-label="Actividad">
      <option value="">— Actividad (opcional) —</option>
      {ops.conceptos.length > 0 && (
        <optgroup label="Conceptos de la estimación">
          {ops.conceptos.map(c => <option key={c.id} value={`c:${c.id}`}>{c.key} {c.description}</option>)}
        </optgroup>
      )}
      {ops.actividades.length > 0 && (
        <optgroup label="Actividades (Toggl)">
          {ops.actividades.map(a => <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>)}
        </optgroup>
      )}
    </select>
  )
}
export const partir = v => ({ actividad_id: v?.startsWith('a:') ? +v.slice(2) : null, concepto_id: v?.startsWith('c:') ? v.slice(2) : null })
export const juntar = r => (r.concepto_id ? `c:${r.concepto_id}` : r.actividad_id ? `a:${r.actividad_id}` : '')

