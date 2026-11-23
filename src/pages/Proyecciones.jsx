import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchMyAssignments } from '../lib/directorio'
import { toast } from '../components/Toast'
import GraficaProyecciones from '../components/GraficaProyecciones'
import { fmtMoney } from '../utils/format'
import {
  AREAS, COLOR_AREA, mesIso, sumarMeses, textoMes, textoMesCorto, rangoMeses, prepararProyecto, estimadoPorMes, sumarProyecciones,
  estaCongelada, textoCongelamiento, quienProyecta, responsables,
} from '../lib/proyecciones'


const corto = v => (v ? `$${Math.round(v).toLocaleString('es-MX')}` : '')
const Punto = ({ area }) => <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[area], flex: 'none' }} />

/** Vista general: proyección de cobro de la empresa por mes, por área, por proyecto y por concepto. */
export default function Proyecciones() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [datos, setDatos] = useState(null)
  const [vista, setVista] = useState('proximas') // próximas (12 meses al futuro) o pasadas (archivo)
  const [mesSel, setMesSel] = useState('') // '' = todos los meses de la vista
  const [estado, setEstado] = useState('Activo')
  const [area, setArea] = useState('Todas')
  const [porArea, setPorArea] = useState(false)
  const [conConceptos, setConConceptos] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [soloMios, setSoloMios] = useState(false)
  const [mios, setMios] = useState({})
  const hoy = mesIso(new Date())

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))'),
      supabase.from('proyecciones').select('id, project_id, mes, area, monto, tbd, concept_id, descripcion, creado_por'),
      supabase.from('project_members').select('project_id, rol, email'),
      supabase.from('directorio').select('nombre, email'),
    ]).then(([p, pr, mi, di]) => {
      if (pr.error) toast('Faltan las tablas de proyecciones en la base (migration_2026_11_proyecciones.sql)', true)
      const nombrePorEmail = Object.fromEntries((di.data || []).filter(d => d.email).map(d => [d.email.toLowerCase(), d.nombre]))
      const projects = p.data || []
      const conceptos = new Map()
      for (const x of projects) for (const d of x.disciplines || []) for (const c of d.concepts || []) conceptos.set(c.id, { c, orden: (d.sort_order || 0) * 1e4 + (c.sort_order || 0) })
      setDatos({ projects, proyecciones: pr.data || [], nombrePorEmail, conceptos, lideres: responsables(projects, mi.data || [], nombrePorEmail) })
    })
  }, [])
  useEffect(() => { if (profile?.email) fetchMyAssignments(profile.email).then(setMios) }, [profile?.email])

  const todos = useMemo(() => datos ? [...new Set(datos.proyecciones.map(f => f.mes))].sort() : [], [datos])
  // Próximas: este mes y los 11 que siguen (se recorre solo cada mes). Pasadas: desde la primera proyección hasta el mes anterior.
  const mesesPasados = useMemo(() => (todos.length && todos[0] < hoy ? rangoMeses(todos[0], sumarMeses(hoy, -1)).reverse() : []), [todos, hoy])
  const opciones = useMemo(() => vista === 'proximas' ? rangoMeses(hoy, sumarMeses(hoy, 11)) : mesesPasados, [vista, mesesPasados, hoy])
  const meses = useMemo(() => (mesSel ? [mesSel] : [...opciones].sort()), [mesSel, opciones])
  const pasadas = vista === 'pasadas'

  const filas = useMemo(() => {
    if (!datos) return []
    const areas = area === 'Todas' ? AREAS : [area]
    const out = []
    for (const p of datos.projects) {
      if (estado !== 'Todos' && p.status !== estado) continue
      if (soloMios && !mios[p.id] && p.user_id !== profile?.id) continue
      const pr = datos.proyecciones.filter(f => f.project_id === p.id && meses.includes(f.mes) && areas.includes(f.area))
      if (!pr.length) continue
      const d = prepararProyecto(p)
      const est = estimadoPorMes(p, d.disciplines, d.estimations)
      const s = sumarProyecciones(pr)
      const quien = [...new Set(pr.map(f => quienProyecta(f.creado_por, datos.nombrePorEmail)).filter(Boolean))]
      // Conceptos: una fila por concepto (o descripción libre) con lo proyectado en cada mes
      const porConcepto = new Map()
      for (const f of pr) {
        const k = f.concept_id || `${f.area}|${f.descripcion}`
        const info = f.concept_id && datos.conceptos.get(f.concept_id)
        const o = porConcepto.get(k) || { k, area: f.area, clave: info ? info.c.key : '', texto: info ? info.c.description : f.descripcion, orden: info ? info.orden : 1e9, meses: {}, tbd: {}, quien: new Set(), total: 0 }
        if (f.tbd && !(+f.monto > 0)) o.tbd[f.mes] = true
        else { o.meses[f.mes] = (o.meses[f.mes] || 0) + (+f.monto || 0); o.total += +f.monto || 0 }
        const q = quienProyecta(f.creado_por, datos.nombrePorEmail); if (q) o.quien.add(q)
        porConcepto.set(k, o)
      }
      const conceptos = [...porConcepto.values()].sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || a.orden - b.orden || String(a.clave).localeCompare(String(b.clave), 'es', { numeric: true }))
      out.push({ p, s, est, quien, conceptos, lider: datos.lideres[p.id] || '' })
    }
    return out.sort((a, b) => b.s.total - a.s.total || b.s.tbd - a.s.tbd)
  }, [datos, estado, area, meses, soloMios, mios, profile?.id])

  if (!datos) return <div className="main"><div className="spinner" /></div>

  const areas = area === 'Todas' ? AREAS : [area]
  const proyectado = {}, estimado = {}
  for (const { s, est } of filas) {
    for (const m of meses) for (const a of areas) {
      if (s.porMes[m]?.[a]) { proyectado[m] ||= {}; proyectado[m][a] = (proyectado[m][a] || 0) + s.porMes[m][a] }
      if (est[m]?.[a]) { estimado[m] ||= {}; estimado[m][a] = (estimado[m][a] || 0) + est[m][a] }
    }
  }
  const totalArea = Object.fromEntries(areas.map(a => [a, meses.reduce((x, m) => x + (proyectado[m]?.[a] || 0), 0)]))
  const total = Object.values(totalArea).reduce((x, v) => x + v, 0)
  const totalTbd = filas.reduce((x, f) => x + f.s.tbd, 0)
  const mesActual = areas.reduce((x, a) => x + (proyectado[hoy]?.[a] || 0), 0)
  const totalMes = m => areas.reduce((x, a) => x + (proyectado[m]?.[a] || 0), 0)
  // Meses con estimaciones de un solo mes en los proyectos que se ven (lo de antes de la migración viene acumulado)
  const mesesReales = new Set(filas.flatMap(({ est }) => Object.entries(est).filter(([, v]) => Object.values(v).some(x => x > 0)).map(([m]) => m)))
  const conDatos = m => mesesReales.has(m)
  const mesesConDatos = meses.filter(conDatos)
  const estArea = Object.fromEntries(areas.map(a => [a, meses.reduce((x, m) => x + (estimado[m]?.[a] || 0), 0)]))
  const totalEst = Object.values(estArea).reduce((x, v) => x + v, 0)
  // Cumplimiento solo con los meses que sí tienen estimaciones por mes
  const proyConDatos = mesesConDatos.reduce((x, m) => x + totalMes(m), 0)
  const proyAreaConDatos = a => mesesConDatos.reduce((x, m) => x + (proyectado[m]?.[a] || 0), 0)
  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
  const estMes = m => areas.reduce((x, a) => x + (estimado[m]?.[a] || 0), 0)
  const delMes = (s, m, a) => (a ? s.porMes[m]?.[a] || 0 : areas.reduce((x, k) => x + (s.porMes[m]?.[k] || 0), 0))
  const estaAbierto = id => conConceptos || abiertos.has(id)
  const alternar = id => setAbiertos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const cambiarVista = v => { setVista(v); setMesSel('') }
  const thMes = m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined, whiteSpace: 'nowrap' }} title={estaCongelada(m) ? `Congelada desde el ${textoCongelamiento(m)}` : `Se congela el ${textoCongelamiento(m)}`}>{textoMesCorto(m)}{estaCongelada(m) ? ' 🔒' : ''}</th>
  const pie = { fontSize: 11, color: 'var(--text-muted)' }

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span><span className="current">Proyecciones</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 className="page-title">Proyecciones <span style={{ color: 'var(--green-dark)' }}>de cobro</span></h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Lo que cada proyecto piensa estimar, por mes de la estimación (se factura al mes siguiente)</div>
        </div>
      </div>

      <div className="pestanas-proy" role="tablist">
        <button role="tab" aria-selected={!pasadas} className={!pasadas ? 'activa' : ''} onClick={() => cambiarVista('proximas')}>
          Próximas<span>{textoMesCorto(hoy)} – {textoMesCorto(sumarMeses(hoy, 11))}</span>
        </button>
        <button role="tab" aria-selected={pasadas} className={pasadas ? 'activa' : ''} onClick={() => cambiarVista('pasadas')}>
          🗂 Proyecciones pasadas<span>{mesesPasados.length ? `${mesesPasados.length} meses archivados · congeladas` : 'todavía no hay'}</span>
        </button>
      </div>

      <div className="card mb-md" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px' }}>
        <select value={mesSel} onChange={e => setMesSel(e.target.value)} style={{ fontSize: 13 }} aria-label="Mes">
          <option value="">{pasadas ? 'Todos los meses pasados' : `Los 12 meses (${textoMesCorto(opciones[0])} – ${textoMesCorto(opciones.at(-1))})`}</option>
          {opciones.map(m => <option key={m} value={m}>{textoMes(m)}{estaCongelada(m) ? ' 🔒' : ''}</option>)}
        </select>
        <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <select value={estado} onChange={e => setEstado(e.target.value)} style={{ fontSize: 13 }}>
          {['Activo', 'Pausado', 'Terminado', 'Todos'].map(s => <option key={s} value={s}>{s === 'Todos' ? 'Todos los estados' : `Proyectos ${s.toLowerCase()}s`}</option>)}
        </select>
        <select value={area} onChange={e => setArea(e.target.value)} style={{ fontSize: 13 }}>
          <option value="Todas">Todas las áreas</option>
          {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={soloMios} onChange={e => setSoloMios(e.target.checked)} /> Solo mis proyectos</label>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={conConceptos} onChange={e => { setConConceptos(e.target.checked); if (e.target.checked) setPorArea(false) }} /> Ver todos los conceptos</label>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={porArea} onChange={e => { setPorArea(e.target.checked); if (e.target.checked) setConConceptos(false) }} /> Desglosar por área</label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="stat-box"><div className="stat-label">{pasadas ? 'Proyectado (congelado)' : 'Total proyectado'}</div><div className="stat-value green">{fmtMoney(total)}</div><div className="stat-sub">{meses.length ? (meses.length === 1 ? textoMes(meses[0]) : `${textoMesCorto(meses[0])} – ${textoMesCorto(meses.at(-1))}`) : 'sin meses pasados'} · {filas.length} proyectos{totalTbd ? ` · ${totalTbd} conceptos por definir` : ''}</div></div>
        {pasadas
          ? <div className="stat-box"><div className="stat-label">Estimado (enviado)</div><div className="stat-value">{fmtMoney(totalEst)}</div><div className="stat-sub">{mesesConDatos.length ? `cumplimiento ${pct(totalEst, proyConDatos)} (${mesesConDatos.length === meses.length ? 'todos los meses' : `en ${mesesConDatos.length} ${mesesConDatos.length === 1 ? 'mes con datos' : 'meses con datos'}`})` : 'sin estimaciones por mes en estos meses'}</div></div>
          : <div className="stat-box"><div className="stat-label">{textoMes(hoy)}{estaCongelada(hoy) ? ' 🔒' : ''}</div><div className="stat-value">{fmtMoney(mesActual)}</div><div className="stat-sub">{estaCongelada(hoy) ? `congelada desde el ${textoCongelamiento(hoy)}` : `se congela el ${textoCongelamiento(hoy)}`}</div></div>}
        {areas.map(a => (
          <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Punto area={a} />{a}</div><div className="stat-value">{fmtMoney(totalArea[a])}</div><div className="stat-sub">{pasadas ? `estimado ${fmtMoney(estArea[a])}${mesesConDatos.length ? ` · ${pct(estArea[a], proyAreaConDatos(a))}` : ''}` : total > 0 ? `${Math.round((totalArea[a] / total) * 100)}% del total` : '—'}</div></div>
        ))}
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">{pasadas ? 'Proyectado (congelado) contra estimado' : 'Proyección por mes'}</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔒 Cada mes se congela el día 15 (o el siguiente día hábil)</span></div>
        <GraficaProyecciones meses={meses} proyectado={proyectado} estimado={estimado} areas={areas} hoy={hoy} />
        <div style={{ ...pie, marginTop: 6 }}>Montos en MXN y USD sumados tal cual. Lo estimado no cuenta la estimación de arranque de cada proyecto migrado, porque trae todo lo cobrado antes.</div>
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">Total por área y mes</span>{pasadas && meses.some(m => !conDatos(m)) && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>"Sin datos": meses sin estimaciones por mes en la app (la migración cargó lo cobrado acumulado)</span>}</div>
        <div className="table-wrap">
          <table style={{ fontSize: 12 }}>
            <thead><tr><th>Área</th>{meses.map(thMes)}<th className="num">Total</th></tr></thead>
            <tbody>
              {areas.map(a => (
                <tr key={a}><td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Punto area={a} />{a}</span></td>
                  {meses.map(m => <td key={m} className="num">{corto(proyectado[m]?.[a])}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(totalArea[a])}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>{pasadas ? 'Total proyectado' : 'Total'}</td>{meses.map(m => <td key={m} className="num">{corto(totalMes(m))}</td>)}<td className="num">{corto(total)}</td></tr>
              {pasadas && <>
                <tr><td>Estimado (enviado)</td>{meses.map(m => <td key={m} className="num" style={{ color: conDatos(m) ? undefined : 'var(--text-soft)' }}>{conDatos(m) ? corto(estMes(m)) || '$0' : 'sin datos'}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(totalEst)}</td></tr>
                <tr style={{ color: 'var(--text-muted)' }}><td>Cumplimiento</td>{meses.map(m => <td key={m} className="num">{conDatos(m) && totalMes(m) > 0 ? pct(estMes(m), totalMes(m)) : ''}</td>)}<td className="num" style={{ fontWeight: 700 }}>{mesesConDatos.length ? pct(totalEst, proyConDatos) : '—'}</td></tr>
              </>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-header">
          <span className="section-title">{pasadas ? 'Proyecciones pasadas por proyecto y concepto' : 'Por proyecto y concepto'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>▸ abre los conceptos del proyecto · clic en el nombre para ver o capturar sus proyecciones</span>
        </div>
        {filas.length === 0 ? <div className="empty-state"><h3>Sin proyecciones con estos filtros</h3></div> : (
          <div className="table-wrap">
            <table style={{ fontSize: 12 }} className="tabla-proy">
              <thead><tr>
                <th style={{ minWidth: 240 }}>Proyecto / concepto</th>{porArea && <th>Área</th>}
                <th>Responsable</th><th>Proyecta</th>
                {meses.map(thMes)}<th className="num">Total</th>{pasadas && <><th className="num">Estimado</th><th className="num">Cumpl.</th></>}
              </tr></thead>
              <tbody>
                {filas.map(({ p, s, est, quien, conceptos, lider }) => {
                  const estDe = a => meses.reduce((x, m) => x + (a ? est[m]?.[a] || 0 : areas.reduce((y, k) => y + (est[m]?.[k] || 0), 0)), 0)
                  const abierto = estaAbierto(p.id)
                  const nombre = (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                      {!porArea && <button className="btn-flecha" onClick={() => alternar(p.id)} aria-expanded={abierto} aria-label={abierto ? 'Ocultar conceptos' : 'Ver conceptos'}>{abierto ? '▾' : '▸'}</button>}
                      <span>
                        <a style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate(`/projects/${p.id}/proyecciones`)}>{p.name}</a>
                        {p.currency === 'USD' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-soft)' }}>USD</span>}
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-soft)', whiteSpace: 'nowrap' }}>{conceptos.length} {conceptos.length === 1 ? 'concepto' : 'conceptos'}{s.tbd ? ` · ${s.tbd} por definir` : ''}</span>
                      </span>
                    </span>
                  )
                  const gente = <><td style={{ whiteSpace: 'nowrap' }}>{lider || <span style={{ color: 'var(--text-soft)' }}>sin líder</span>}</td><td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 170 }}>{quien.join(', ')}</td></>
                  if (porArea) {
                    const conArea = areas.filter(a => s.porArea[a] > 0)
                    return conArea.map((a, i) => (
                      <tr key={p.id + a} style={i === conArea.length - 1 ? undefined : { borderBottom: 0 }}>
                        <td>{i === 0 ? nombre : null}</td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><Punto area={a} />{a}</span></td>
                        {i === 0 ? gente : <><td /><td /></>}
                        {meses.map(m => <td key={m} className="num">{corto(delMes(s, m, a))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.porArea[a])}</td>
                        {pasadas && <><td className="num">{corto(estDe(a))}</td><td className="num" style={{ color: 'var(--text-muted)' }}>{mesesConDatos.length ? pct(estDe(a), mesesConDatos.reduce((x, m) => x + delMes(s, m, a), 0)) : '—'}</td></>}
                      </tr>
                    ))
                  }
                  return (
                    <Fragment key={p.id}>
                      <tr className={abierto ? 'fila-proyecto abierta' : 'fila-proyecto'}>
                        <td>{nombre}</td>{gente}
                        {meses.map(m => <td key={m} className="num">{corto(delMes(s, m))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.total)}</td>
                        {pasadas && <><td className="num">{corto(estDe())}</td><td className="num" style={{ color: 'var(--text-muted)' }}>{mesesConDatos.length ? pct(estDe(), mesesConDatos.reduce((x, m) => x + delMes(s, m), 0)) : '—'}</td></>}
                      </tr>
                      {abierto && conceptos.map(c => (
                        <tr key={p.id + c.k} className="fila-concepto">
                          <td title={c.texto}>
                            <span className="concepto-linea"><Punto area={c.area} />{c.clave && <strong>{c.clave}</strong>}<span className="concepto-texto">{c.texto || '—'}</span></span>
                          </td>
                          <td /><td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[...c.quien].join(', ')}</td>
                          {meses.map(m => <td key={m} className="num">{c.meses[m] ? corto(c.meses[m]) : c.tbd[m] ? <span className="por-definir">Por definir</span> : ''}</td>)}
                          <td className="num">{c.total ? corto(c.total) : <span className="por-definir">Por definir</span>}</td>
                          {pasadas && <><td /><td /></>}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ ...pie, marginTop: 8 }}>"Proyecta": quién capturó la proyección en la app, o la hoja del Excel de Proyecciones 2026 de donde viene. "Por definir": el concepto está proyectado para ese mes, pero todavía sin monto.</div>
      </div>
    </div>
  )
}
