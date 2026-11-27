import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAjeno, AVISO_AJENO } from '../hooks/useAjeno'
import { isReadOnlyRole } from '../lib/directorio'
import { toast } from '../components/Toast'
import GraficaProyecciones from '../components/GraficaProyecciones'
import FormProyeccion from '../components/FormProyeccion'
import { fmtMoney } from '../utils/format'
import { mesDelPeriodo } from '../utils/cierre'
import {
  AREAS, COLOR_AREA, mesIso, sumarMeses, textoMes, mesFactura, rangoMeses, prepararProyecto,
  estimadoPorMes, conceptosPorEstimar, sumarProyecciones, estaCongelada, textoCongelamiento, quienProyecta, responsables, equipos,
} from '../lib/proyecciones'

const Chip = ({ area }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
    <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[area] }} />{area}
  </span>
)

/** Proyecciones de cobro de un proyecto: captura por mes (y concepto) y gráfica proyectado vs estimado. */
export default function ProyeccionesProyecto() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [project, setProject] = useState(null)
  const [filas, setFilas] = useState([])
  const [form, setForm] = useState(null)
  const [gente, setGente] = useState({ nombrePorEmail: {}, lider: '' })
  const ajeno = useAjeno(project, profile)
  const soloLectura = isReadOnlyRole(profile) || ajeno
  const hoy = mesIso(new Date())

  async function cargar() {
    const [p, pr, mi, di] = await Promise.all([
      supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))').eq('id', id).single(),
      supabase.from('proyecciones').select('*').eq('project_id', id).order('mes'),
      supabase.from('project_members').select('project_id, rol, email').eq('project_id', id),
      supabase.from('directorio').select('nombre, email'),
    ])
    const nombrePorEmail = Object.fromEntries((di.data || []).filter(d => d.email).map(d => [d.email.toLowerCase(), d.nombre]))
    if (!p.error) setGente({ nombrePorEmail, lider: responsables([p.data], mi.data || [], nombrePorEmail)[p.data.id], equipo: equipos([p.data], mi.data || [], nombrePorEmail)[p.data.id] })
    if (p.error) { toast('No se pudo cargar el proyecto', true); return }
    setProject(p.data)
    setFilas(pr.error ? [] : pr.data || [])
    if (pr.error) toast('Faltan las tablas de proyecciones en la base (migration_2026_11_proyecciones.sql)', true)
  }
  useEffect(() => { cargar() }, [id])

  const datos = useMemo(() => project && prepararProyecto(project), [project])
  const pendientes = useMemo(() => datos ? conceptosPorEstimar(project, datos.disciplines, datos.estimations) : [], [datos])
  const estimado = useMemo(() => datos ? estimadoPorMes(project, datos.disciplines, datos.estimations) : {}, [datos])
  const conceptoDe = cid => pendientes.find(x => x.concept.id === cid) || (() => {
    for (const d of datos?.disciplines || []) { const c = d.concepts.find(c => c.id === cid); if (c) return { concept: c, discipline: d } }
    return null
  })()

  if (!project) return <div className="main"><div className="spinner" /></div>
  const moneda = project.currency || 'MXN'
  const s = sumarProyecciones(filas)
  const futuras = filas.filter(f => f.mes >= hoy)
  const sf = sumarProyecciones(futuras)
  const meses = rangoMeses(sumarMeses(hoy, -6), sumarMeses(hoy, 12))
  // Primero lo que viene (de este mes en adelante), luego lo pasado del más reciente al más viejo
  const todos = [...new Set(filas.map(f => f.mes))].sort()
  const proximos = todos.filter(m => m >= hoy)
  const pasados = todos.filter(m => m < hoy).reverse()
  // Meses que todavía se pueden proyectar: los que no están congelados (desde el 15 o el siguiente hábil)
  const mesesAbiertos = rangoMeses(hoy, sumarMeses(hoy, 18)).filter(m => !estaCongelada(m))
  // Lo ya cobrado por concepto en cada mes (para marcar lo proyectado que ya se estimó)
  const cobrado = new Map()
  for (const e of datos.estimations) if (e.status === 'Enviada') for (const it of e.estimation_items || []) if (it.included) cobrado.set(it.concept_id, mesDelPeriodo(e.period_from, e.period_to))

  function nueva() {
    setForm({ mes: mesesAbiertos[0] }); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function borrar(f) {
    if (!window.confirm(`¿Quitar la proyección "${f.descripcion || 'sin descripción'}" de ${textoMes(f.mes)}?`)) return
    const { error } = await supabase.from('proyecciones').delete().eq('id', f.id)
    if (error) toast('No se pudo quitar: ' + error.message, true); else cargar()
  }


  const tarjetaMes = m => {
        // Primero lo que trae monto, al final lo que está por definir
        const delMes = filas.filter(f => f.mes === m).sort((x, y) => (x.tbd && !(+x.monto > 0)) - (y.tbd && !(+y.monto > 0)) || AREAS.indexOf(x.area) - AREAS.indexOf(y.area) || String(x.descripcion).localeCompare(String(y.descripcion), 'es', { numeric: true }))
        const sm = sumarProyecciones(delMes)
        const est = estimado[m] ? AREAS.reduce((x, a) => x + (estimado[m][a] || 0), 0) : 0
        const editable = !soloLectura && !estaCongelada(m)
        return (
          <div key={m} className="card mb-md">
            <div className="section-header" style={{ marginBottom: 8 }}>
              <span className="section-title">{textoMes(m)}{m === hoy ? ' · este mes' : ''}{estaCongelada(m) && <span title="Ya no se puede cambiar: queda como la proyección comprometida del mes" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 8 }}>🔒 Congelada desde el {textoCongelamiento(m)}</span>}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Proyectado <strong style={{ color: 'var(--navy)' }}>{fmtMoney(sm.total, moneda)}</strong>
                {est > 0 && <> · estimado {fmtMoney(est, moneda)}</>} · se factura en {textoMes(mesFactura(m))}
              </span>
            </div>
            <div className="table-wrap">
              <table style={{ fontSize: 12 }}>
                <thead><tr><th>Concepto</th><th>Área</th><th className="num">Monto</th><th>Estado</th><th>Proyecta</th>{editable && <th />}</tr></thead>
                <tbody>
                  {delMes.map(f => {
                    const c = f.concept_id && conceptoDe(f.concept_id)
                    const mesCobro = f.concept_id && cobrado.get(f.concept_id)
                    return (
                      <tr key={f.id}>
                        <td>{c ? <><strong>{c.concept.key}</strong> {c.concept.description}</> : f.descripcion || '—'}</td>
                        <td><Chip area={f.area} /></td>
                        <td className="num">{f.tbd && !(+f.monto > 0) ? <span style={{ color: 'var(--warning)' }}>Por definir</span> : fmtMoney(f.monto, moneda)}</td>
                        <td style={{ fontSize: 11 }}>{mesCobro ? <span style={{ color: 'var(--green-dark)' }}>✓ Estimado en {textoMes(mesCobro)}</span> : f.concept_id ? <span style={{ color: 'var(--text-muted)' }}>Se sugiere en la estimación</span> : <span style={{ color: 'var(--text-soft)' }}>—</span>}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{quienProyecta(f.creado_por, gente.nombrePorEmail)}</td>
                        {editable && <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-outline" onClick={() => setForm({ id: f.id, mes: f.mes, concept_id: f.concept_id || '', area: f.area, descripcion: f.descripcion, monto: f.monto, tbd: f.tbd })}>Cambiar</button>{' '}
                          <button className="btn btn-sm btn-danger" onClick={() => borrar(f)}>✕</button>
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>{[<td key="t" style={{ fontWeight: 700 }}>Total del mes</td>, <td key="a" style={{ fontSize: 11 }}>{AREAS.filter(a => sm.porArea[a]).map(a => `${a}: ${fmtMoney(sm.porArea[a], moneda)}`).join(' · ')}</td>, <td key="m" className="num" style={{ fontWeight: 700 }}>{fmtMoney(sm.total, moneda)}</td>, <td key="x" colSpan={editable ? 3 : 2} />]}</tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
  }

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/proyectos')}>Mis Proyectos</a><span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a><span className="sep">›</span>
        <span className="current">Proyecciones</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Proyecciones <span style={{ color: 'var(--green-dark)' }}>de cobro</span></h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{project.name}{project.client ? ` · ${project.client}` : ''} · Responsable: <strong style={{ color: 'var(--navy)' }}>{gente.lider || 'sin líder asignado'}</strong>{gente.equipo?.length ? ` · Equipo: ${gente.equipo.join(' · ')}` : ''}</div>
        </div>
        <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/estimations/current`)}>Estimación del mes</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>Historial</button>
          {!soloLectura && <button className="btn btn-primary" onClick={nueva}>＋ Agregar proyección</button>}
        </div>
      </div>
      {ajeno && <div className="readonly-banner">{AVISO_AJENO}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="stat-box"><div className="stat-label">Por cobrar (de {textoMes(hoy)} en adelante)</div><div className="stat-value green">{fmtMoney(sf.total, moneda)}</div><div className="stat-sub">{futuras.length} proyecciones{sf.tbd ? ` · ${sf.tbd} por definir` : ''}</div></div>
        {AREAS.map(a => (
          <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</div><div className="stat-value">{fmtMoney(sf.porArea[a], moneda)}</div><div className="stat-sub">de {textoMes(hoy)} en adelante</div></div>
        ))}
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">Proyectado contra estimado</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Por mes de la estimación · se factura al mes siguiente</span></div>
        <GraficaProyecciones meses={meses} proyectado={s.porMes} estimado={estimado} moneda={moneda} hoy={hoy} />
      </div>

      {form && (
        <FormProyeccion key={form.id || 'nueva'} proyectos={[project]} inicial={{ ...form, project_id: id }} proyecciones={filas}
          onGuardado={() => { setForm(null); cargar() }} onCancelar={() => setForm(null)} />
      )}

      {proximos.length === 0 && pasados.length === 0 ? (
        <div className="empty-state"><h3>Sin proyecciones</h3><p style={{ color: 'var(--text-muted)' }}>Agrega lo que se piensa cobrar en los meses que vienen.</p></div>
      ) : <>
        {proximos.length === 0 && <div className="empty-state"><h3>Sin proyecciones para los meses que vienen</h3></div>}
        {proximos.map(tarjetaMes)}
        {pasados.length > 0 && (
          <details className="card mb-md">
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)' }}>
              Proyecciones pasadas · {pasados.length} {pasados.length === 1 ? 'mes archivado' : 'meses archivados'}
              <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                Proyectado {fmtMoney(sumarProyecciones(filas.filter(f => f.mes < hoy)).total, moneda)} · estimado {fmtMoney(pasados.reduce((x, m) => x + AREAS.reduce((y, a) => y + (estimado[m]?.[a] || 0), 0), 0), moneda)}
              </span>
            </summary>
            <div style={{ marginTop: 12 }}>{pasados.map(tarjetaMes)}</div>
          </details>
        )}
      </>}
    </div>
  )
}
