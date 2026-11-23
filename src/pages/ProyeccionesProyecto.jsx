import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAjeno, AVISO_AJENO } from '../hooks/useAjeno'
import { isReadOnlyRole } from '../lib/directorio'
import { toast } from '../components/Toast'
import GraficaProyecciones from '../components/GraficaProyecciones'
import { fmtMoney } from '../utils/format'
import { mesDelPeriodo } from '../utils/cierre'
import {
  AREAS, COLOR_AREA, mesIso, sumarMeses, textoMes, mesFactura, rangoMeses, prepararProyecto,
  estimadoPorMes, conceptosPorEstimar, sumarProyecciones,
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
  const [guardando, setGuardando] = useState(false)
  const ajeno = useAjeno(project, profile)
  const soloLectura = isReadOnlyRole(profile) || ajeno
  const hoy = mesIso(new Date())

  async function cargar() {
    const [p, pr] = await Promise.all([
      supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))').eq('id', id).single(),
      supabase.from('proyecciones').select('*').eq('project_id', id).order('mes'),
    ])
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
  const porMes = [...todos.filter(m => m >= hoy), ...todos.filter(m => m < hoy).reverse()]
  // Lo ya cobrado por concepto en cada mes (para marcar lo proyectado que ya se estimó)
  const cobrado = new Map()
  for (const e of datos.estimations) if (e.status === 'Enviada') for (const it of e.estimation_items || []) if (it.included) cobrado.set(it.concept_id, mesDelPeriodo(e.period_from, e.period_to))

  function nueva() {
    setForm({ mes: sumarMeses(hoy, 0), concept_id: '', area: 'Consultoría', descripcion: '', monto: '', tbd: false })
  }
  function elegirConcepto(cid) {
    const x = pendientes.find(p => p.concept.id === cid)
    setForm(f => ({ ...f, concept_id: cid, area: x ? x.area : f.area, descripcion: x ? `${x.concept.key} ${x.concept.description}`.trim() : f.descripcion, monto: x ? Math.round(x.porEstimar * 100) / 100 : f.monto }))
  }

  async function guardar() {
    if (!form.tbd && !(+form.monto > 0)) { toast('Escribe el monto (o marca "Por definir")', true); return }
    if (!form.concept_id && !form.descripcion.trim()) { toast('Elige un concepto o escribe qué se va a cobrar', true); return }
    setGuardando(true)
    const fila = { project_id: id, mes: form.mes, area: form.area, concept_id: form.concept_id || null, descripcion: form.descripcion.trim(), monto: +form.monto || 0, tbd: !!form.tbd, updated_at: new Date().toISOString() }
    const { error } = form.id
      ? await supabase.from('proyecciones').update(fila).eq('id', form.id)
      : await supabase.from('proyecciones').insert(fila)
    setGuardando(false)
    if (error) { toast(/proyecciones_concepto_mes/.test(error.message) ? 'Ese concepto ya está proyectado en ese mes' : 'No se pudo guardar: ' + error.message, true); return }
    toast('Proyección guardada ✓')
    setForm(null); cargar()
  }

  async function borrar(f) {
    if (!window.confirm(`¿Quitar la proyección "${f.descripcion || 'sin descripción'}" de ${textoMes(f.mes)}?`)) return
    const { error } = await supabase.from('proyecciones').delete().eq('id', f.id)
    if (error) toast('No se pudo quitar: ' + error.message, true); else cargar()
  }

  const yaProyectados = new Set(filas.filter(f => form && f.mes === form.mes && f.id !== form.id).map(f => f.concept_id).filter(Boolean))

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a><span className="sep">›</span>
        <span className="current">Proyecciones</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Proyecciones <span style={{ color: 'var(--green-dark)' }}>de cobro</span></h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{project.name}{project.client ? ` · ${project.client}` : ''}</div>
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
        <div className="card mb-md" style={{ borderLeft: '4px solid var(--green)' }}>
          <div className="section-header"><span className="section-title">{form.id ? 'Cambiar proyección' : 'Nueva proyección'}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="field">
              <label>Mes de la estimación</label>
              <select value={form.mes} onChange={e => setForm(f => ({ ...f, mes: e.target.value }))}>
                {rangoMeses(sumarMeses(hoy, -12), sumarMeses(hoy, 18)).map(m => <option key={m} value={m}>{textoMes(m)}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Se factura en {textoMes(mesFactura(form.mes))}</div>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label>Concepto por cobrar</label>
              <select value={form.concept_id} onChange={e => e.target.value ? elegirConcepto(e.target.value) : setForm(f => ({ ...f, concept_id: '' }))}>
                <option value="">— Otro (sin concepto: escribe la descripción) —</option>
                {datos.disciplines.map(d => {
                  const ps = pendientes.filter(p => p.discipline.id === d.id && (!yaProyectados.has(p.concept.id) || p.concept.id === form.concept_id))
                  if (!ps.length) return null
                  return (
                    <optgroup key={d.id} label={d.name}>
                      {ps.map(p => <option key={p.concept.id} value={p.concept.id}>{p.concept.key} · {(p.concept.description || '').slice(0, 70)} — {fmtMoney(p.porEstimar, moneda)}</option>)}
                    </optgroup>
                  )
                })}
              </select>
              {form.concept_id && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Se sugiere en la estimación de {textoMes(form.mes)} (un clic para marcarlo).</div>}
            </div>
            <div className="field">
              <label>Área</label>
              <select value={form.area} disabled={!!form.concept_id} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}>
                {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {!form.concept_id && (
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label>Descripción</label>
                <input value={form.descripcion} placeholder="Ej. Hito 2: pruebas funcionales" onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
              </div>
            )}
            <div className="field">
              <label>Monto</label>
              <input type="number" min="0" step="0.01" value={form.monto} disabled={form.tbd} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={form.tbd} onChange={e => setForm(f => ({ ...f, tbd: e.target.checked, monto: e.target.checked ? '' : f.monto }))} /> Por definir (sin monto todavía)
              </label>
            </div>
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {porMes.length === 0 ? (
        <div className="empty-state"><h3>Sin proyecciones</h3><p style={{ color: 'var(--text-muted)' }}>Agrega lo que se piensa cobrar en los meses que vienen.</p></div>
      ) : porMes.map(m => {
        const delMes = filas.filter(f => f.mes === m)
        const sm = sumarProyecciones(delMes)
        const est = estimado[m] ? AREAS.reduce((x, a) => x + (estimado[m][a] || 0), 0) : 0
        return (
          <div key={m} className="card mb-md" style={{ opacity: m < hoy ? 0.85 : 1 }}>
            <div className="section-header" style={{ marginBottom: 8 }}>
              <span className="section-title">{textoMes(m)}{m === hoy ? ' · este mes' : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Proyectado <strong style={{ color: 'var(--navy)' }}>{fmtMoney(sm.total, moneda)}</strong>
                {est > 0 && <> · estimado {fmtMoney(est, moneda)}</>} · se factura en {textoMes(mesFactura(m))}
              </span>
            </div>
            <div className="table-wrap">
              <table style={{ fontSize: 12 }}>
                <thead><tr><th>Concepto</th><th>Área</th><th className="num">Monto</th><th>Estado</th><th>Capturó</th>{!soloLectura && <th />}</tr></thead>
                <tbody>
                  {delMes.map(f => {
                    const c = f.concept_id && conceptoDe(f.concept_id)
                    const mesCobro = f.concept_id && cobrado.get(f.concept_id)
                    return (
                      <tr key={f.id}>
                        <td>{c ? <><strong>{c.concept.key}</strong> {c.concept.description}</> : f.descripcion || '—'}{f.origen === 'excel' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-soft)' }}>(Excel)</span>}</td>
                        <td><Chip area={f.area} /></td>
                        <td className="num">{f.tbd && !(+f.monto > 0) ? <span style={{ color: 'var(--warning)' }}>Por definir</span> : fmtMoney(f.monto, moneda)}</td>
                        <td style={{ fontSize: 11 }}>{mesCobro ? <span style={{ color: 'var(--green-dark)' }}>✓ Estimado en {textoMes(mesCobro)}</span> : f.concept_id ? <span style={{ color: 'var(--text-muted)' }}>Se sugiere en la estimación</span> : <span style={{ color: 'var(--text-soft)' }}>—</span>}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(f.creado_por || '').split('@')[0]}</td>
                        {!soloLectura && <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-outline" onClick={() => setForm({ id: f.id, mes: f.mes, concept_id: f.concept_id || '', area: f.area, descripcion: f.descripcion, monto: f.monto, tbd: f.tbd })}>Cambiar</button>{' '}
                          <button className="btn btn-sm btn-danger" onClick={() => borrar(f)}>✕</button>
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>{[<td key="t" style={{ fontWeight: 700 }}>Total del mes</td>, <td key="a" style={{ fontSize: 11 }}>{AREAS.filter(a => sm.porArea[a]).map(a => `${a}: ${fmtMoney(sm.porArea[a], moneda)}`).join(' · ')}</td>, <td key="m" className="num" style={{ fontWeight: 700 }}>{fmtMoney(sm.total, moneda)}</td>, <td key="x" colSpan={soloLectura ? 2 : 3} />]}</tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
