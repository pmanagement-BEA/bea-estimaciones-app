import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { estadosConceptos, etiquetaEstado } from '../lib/trackConcepto'
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

// Actividades que existen en (casi) todos los proyectos de Toggl: se ofrecen siempre
export const GENERALES = [
  'CT-00-01 Administración/Comercial: Reunión',
  'CT-00-02 Reporte Mensual y Estimación',
  'CT-00-03 Traslados',
  'Administración',
]
const limpio = n => (n || '').replace(/^#\d+\s*/, '').trim()

/** Conceptos de la estimación (si el proyecto está ligado a la app) + actividades generales + actividades de Toggl del proyecto. */
export function useOpciones(proyecto) {
  const [ops, setOps] = useState({ actividades: [], conceptos: [], generales: [] })
  useEffect(() => {
    if (!proyecto) { setOps({ actividades: [], conceptos: [], generales: [] }); return }
    let vivo = true
    Promise.all([cargarActividades(proyecto.id), cargarConceptos(proyecto.project_id)])
      .then(([a, c]) => {
        if (!vivo) return
        // Una general que ya existe en el proyecto usa su id; si no, se crea al guardar
        const porNombre = new Map(a.map(x => [limpio(x.nombre), x]))
        const generales = GENERALES.map(n => porNombre.get(n) ? { valor: `a:${porNombre.get(n).id}`, nombre: n } : { valor: `g:${n}`, nombre: n })
        const usadas = new Set(generales.filter(g => g.valor.startsWith('a:')).map(g => g.valor))
        setOps({ conceptos: c, generales, actividades: a.filter(x => x.activo && !usadas.has(`a:${x.id}`)) })
        // Cómo va cada concepto (cobrado, proyectado, en borrador): llega después, para no frenar la lista
        if (c.length && proyecto.project_id) estadosConceptos(proyecto.project_id).then(estados => vivo && setOps(o => ({ ...o, estados }))).catch(() => {})
      })
      .catch(() => vivo && setOps({ actividades: [], conceptos: [], generales: [] }))
    return () => { vivo = false }
  }, [proyecto?.id])
  // Después de proyectar o marcar un concepto: vuelve a leer cómo va cada uno para actualizar las etiquetas
  const recargarEstados = useCallback(() => {
    if (proyecto?.project_id) estadosConceptos(proyecto.project_id).then(estados => setOps(o => ({ ...o, estados }))).catch(() => {})
  }, [proyecto?.project_id])
  return useMemo(() => ({ ...ops, recargarEstados }), [ops, recargarEstados])
}

export function SelectorActividad({ ops, valor, alCambiar }) {
  return (
    <select value={valor} onChange={e => alCambiar(e.target.value)} aria-label="Concepto o actividad">
      <option value="">— Concepto o actividad —</option>
      {ops.conceptos.length > 0 && (
        <optgroup label="Conceptos de la estimación">
          {ops.conceptos.map(c => <option key={c.id} value={`c:${c.id}`}>{c.key} {c.description}{ops.estados?.[c.id] ? ` · ${etiquetaEstado(ops.estados[c.id])}` : ''}</option>)}
        </optgroup>
      )}
      {ops.generales?.length > 0 && (
        <optgroup label="Actividades generales">
          {ops.generales.map(g => <option key={g.valor} value={g.valor}>{g.nombre}</option>)}
        </optgroup>
      )}
      {ops.actividades.length > 0 && (
        <optgroup label="Otras actividades del proyecto (Toggl)">
          {ops.actividades.map(a => <option key={a.id} value={`a:${a.id}`}>{limpio(a.nombre)}</option>)}
        </optgroup>
      )}
    </select>
  )
}
export const partir = v => ({ actividad_id: v?.startsWith('a:') ? +v.slice(2) : null, concepto_id: v?.startsWith('c:') ? v.slice(2) : null })
export const juntar = r => (r.concepto_id ? `c:${r.concepto_id}` : r.actividad_id ? `a:${r.actividad_id}` : '')

/** Convierte la opción elegida en columnas; una actividad general que el proyecto no tenía se da de alta. */
export async function resolverActividad(valor, proyectoId) {
  if (!valor?.startsWith('g:')) return partir(valor)
  const nombre = valor.slice(2)
  const { data: ya } = await supabase.from('track_actividades').select('id').eq('proyecto_id', proyectoId).eq('nombre', nombre).limit(1)
  if (ya?.length) return { actividad_id: ya[0].id, concepto_id: null }
  const { data, error } = await supabase.from('track_actividades').insert({ proyecto_id: proyectoId, nombre, origen: 'app' }).select('id').single()
  if (error) throw error
  return { actividad_id: data.id, concepto_id: null }
}
