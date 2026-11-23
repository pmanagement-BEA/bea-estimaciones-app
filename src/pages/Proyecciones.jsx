import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchMyAssignments } from '../lib/directorio'
import { toast } from '../components/Toast'
import GraficaProyecciones from '../components/GraficaProyecciones'
import TarjetaProyeccion from '../components/TarjetaProyeccion'
import FormProyeccion from '../components/FormProyeccion'
import { isReadOnlyRole } from '../lib/directorio'
import { fmtMoney } from '../utils/format'
import {
  AREAS, COLOR_AREA, mesIso, sumarMeses, textoMes, textoMesCorto, rangoMeses, prepararProyecto, estimadoPorMes, estimadoPorConcepto,
  sumarProyecciones, estaCongelada, textoCongelamiento, fechaCongelamiento, quienProyecta, responsables, equipos, versionesDelMes,
} from '../lib/proyecciones'

const corto = v => (v ? `$${Math.round(v).toLocaleString('es-MX')}` : '')
const Punto = ({ area }) => <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[area], flex: 'none', display: 'inline-block' }} />
const fechaTxt = d => new Date(String(d).length <= 10 ? `${d}T12:00:00` : d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
const sinMonto = f => f.tbd && !(+f.monto > 0)
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Proyecciones de cobro de la empresa: por mes (con sus conceptos), resumen de 12 meses y el baúl (pasadas e historial). */
export default function Proyecciones() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const hoy = mesIso(new Date())
  const [datos, setDatos] = useState(null)
  const [tab, setTab] = useState('mes') // mes | anio | baul
  const [mes, setMes] = useState(hoy)
  const [estado, setEstado] = useState('Todos')
  const [area, setArea] = useState('Todas')
  const [buscar, setBuscar] = useState('')
  const [agrupar, setAgrupar] = useState(true)
  const [soloMios, setSoloMios] = useState(false)
  const [mios, setMios] = useState({})
  // Baúl
  const [seccion, setSeccion] = useState('pasados') // pasados | versiones | historial
  const [historial, setHistorial] = useState(null)
  const [mesBaul, setMesBaul] = useState(sumarMeses(hoy, -1))
  const [mesVersiones, setMesVersiones] = useState(hoy)
  const [mesHist, setMesHist] = useState('')
  const [conCarga, setConCarga] = useState(false)
  const [limite, setLimite] = useState(200)
  const [nueva, setNueva] = useState(null) // { project_id?, mes? } mientras se captura una proyección

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
      setDatos({ projects, proyecciones: pr.data || [], nombrePorEmail, conceptos, lideres: responsables(projects, mi.data || [], nombrePorEmail), equipos: equipos(projects, mi.data || [], nombrePorEmail) })
    })
  }, [])
  useEffect(() => { if (profile?.email) fetchMyAssignments(profile.email).then(setMios) }, [profile?.email])
  useEffect(() => {
    if (tab !== 'baul' || historial) return
    supabase.from('proyecciones_historial').select('*').order('hecho_en').then(({ data, error }) => {
      if (error) toast('Falta el historial de proyecciones en la base (migration_2026_11_proyecciones_historial.sql)', true)
      setHistorial(data || [])
    })
  }, [tab, historial])

  const areas = area === 'Todas' ? AREAS : [area]
  // Proyectos que pasan los filtros, con sus proyecciones (del área elegida) y lo estimado de verdad
  const base = useMemo(() => {
    if (!datos) return []
    const t = buscar.trim().toLowerCase()
    const out = []
    for (const p of datos.projects) {
      if (estado !== 'Todos' && p.status !== estado) continue
      if (soloMios && !mios[p.id] && p.user_id !== profile?.id) continue
      const lider = datos.lideres[p.id] || ''
      if (t && !`${p.name} ${p.client || ''} ${lider}`.toLowerCase().includes(t)) continue
      const filas = datos.proyecciones.filter(f => f.project_id === p.id && areas.includes(f.area))
      if (!filas.length) continue
      const d = prepararProyecto(p)
      out.push({ p, lider, filas, est: estimadoPorMes(p, d.disciplines, d.estimations), estC: estimadoPorConcepto(p, d.disciplines, d.estimations) })
    }
    return out
  }, [datos, estado, area, buscar, soloMios, mios, profile?.id])

  if (!datos) return <div className="main"><div className="spinner" /></div>

  // Quién puede capturar: coordinador, dueño o alguien del equipo del proyecto (no "solo lectura")
  const puedeEditar = p => !isReadOnlyRole(profile) && (profile?.role === 'coordinador' || p.user_id === profile?.id || !!mios[p.id]?.length)
  const editables = datos.projects.filter(p => ['Activo', 'Pausado'].includes(p.status) && puedeEditar(p))
  async function recargar() {
    const { data } = await supabase.from('proyecciones').select('id, project_id, mes, area, monto, tbd, concept_id, descripcion, creado_por')
    setDatos(d => ({ ...d, proyecciones: data || d.proyecciones }))
    setHistorial(null)
  }

  const nombre = e => quienProyecta(e, datos.nombrePorEmail)
  // Conceptos de un proyecto en un mes, agrupados (un concepto o descripción libre por renglón)
  const conceptosDe = (b, m) => {
    const out = new Map()
    for (const f of b.filas) {
      if (f.mes !== m) continue
      const k = f.concept_id || `${f.area}|${f.descripcion}`
      const info = f.concept_id && datos.conceptos.get(f.concept_id)
      const o = out.get(k) || { k, area: f.area, clave: info ? info.c.key : '', texto: info ? info.c.description : f.descripcion, orden: info ? info.orden : 1e9, monto: 0, quien: new Set() }
      if (!sinMonto(f)) o.monto += +f.monto || 0
      o.quien.add(nombre(f.creado_por))
      out.set(k, o)
    }
    return [...out.values()].map(o => ({ ...o, quien: [...o.quien].filter(Boolean).join(', ') }))
      .sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || a.orden - b.orden || String(a.clave).localeCompare(String(b.clave), 'es', { numeric: true }))
  }
  const totalDe = (b, m) => b.filas.reduce((s, f) => s + (f.mes === m && !sinMonto(f) ? +f.monto || 0 : 0), 0)
  const abrir = p => () => navigate(`/projects/${p.id}/proyecciones`)

  // Tarjetas de un mes, ordenadas de mayor a menor y (opcional) agrupadas por responsable
  const listaDelMes = (m, cerrado) => {
    const tarjetas = base.map(b => ({ b, conceptos: conceptosDe(b, m), total: totalDe(b, m) })).filter(x => x.conceptos.length).sort((a, b) => b.total - a.total)
    if (!tarjetas.length) return <div className="empty-state"><h3>Sin proyecciones para {textoMes(m)} con estos filtros</h3></div>
    const tarjeta = ({ b, conceptos }) => <TarjetaProyeccion key={b.p.id} p={b.p} lider={b.lider} equipo={datos.equipos[b.p.id]} conceptos={conceptos} estimado={m <= hoy ? b.estC[m] || {} : null} cerrado={cerrado} alAbrir={abrir(b.p)}
      aviso={b.p.status !== 'Activo' && !cerrado ? `Proyecto ${b.p.status.toLowerCase()} con proyección: corrige el estado o quita la proyección` : null}
      alAgregar={!cerrado && !estaCongelada(m) && puedeEditar(b.p) ? () => setNueva({ project_id: b.p.id, mes: m }) : null} />
    if (!agrupar) return <div className="tarjetas-proy">{tarjetas.map(tarjeta)}</div>
    const grupos = new Map()
    for (const t of tarjetas) { const k = t.b.lider || 'Sin líder asignado'; grupos.set(k, [...(grupos.get(k) || []), t]) }
    return [...grupos.entries()].map(([k, ts]) => ({ k, ts, total: ts.reduce((s, t) => s + t.total, 0) })).sort((a, b) => b.total - a.total).map(g => (
      <div key={g.k} className="grupo-proy">
        <div className="grupo-cab"><strong>{g.k}</strong><span>{g.ts.length} {g.ts.length === 1 ? 'proyecto' : 'proyectos'} · {fmtMoney(g.total)}</span></div>
        <div className="tarjetas-proy">{g.ts.map(tarjeta)}</div>
      </div>
    ))
  }

  // Proyectos activos (con los mismos filtros de búsqueda y "solo mis proyectos") que no tienen nada proyectado en el mes
  const sinProyeccion = m => {
    const t = buscar.trim().toLowerCase()
    const conAlgo = new Set(datos.proyecciones.filter(f => f.mes === m).map(f => f.project_id))
    const lista = datos.projects.filter(p => p.status === 'Activo' && !conAlgo.has(p.id)
      && (!soloMios || mios[p.id] || p.user_id === profile?.id)
      && (!t || `${p.name} ${p.client || ''} ${datos.lideres[p.id] || ''}`.toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
    if (!lista.length) return null
    const abierto = !estaCongelada(m)
    return (
      <details className="sin-proy" open>
        <summary>⚠ {lista.length} {lista.length === 1 ? 'proyecto activo sin' : 'proyectos activos sin'} proyección en {textoMes(m)}<span>{abierto ? 'si no se va a cobrar nada, no hay que hacer nada' : 'el mes ya está congelado'}</span></summary>
        <ul>
          {lista.map(p => (
            <li key={p.id}>
              <a onClick={abrir(p)} className="nombre">{p.name}</a>
              <span className="lider">{datos.lideres[p.id] || 'Sin líder asignado'}</span>
              {abierto && puedeEditar(p) ? <button className="btn btn-outline btn-sm" onClick={() => setNueva({ project_id: p.id, mes: m })}>＋ Proyectar</button> : <span />}
            </li>
          ))}
        </ul>
      </details>
    )
  }

  // Sumas por mes y área de los proyectos filtrados
  const sumas = meses => {
    const proyectado = {}, estimado = {}
    for (const b of base) {
      const s = sumarProyecciones(b.filas.filter(f => meses.includes(f.mes)))
      for (const m of meses) for (const a of areas) {
        if (s.porMes[m]?.[a]) { proyectado[m] ||= {}; proyectado[m][a] = (proyectado[m][a] || 0) + s.porMes[m][a] }
        if (b.est[m]?.[a]) { estimado[m] ||= {}; estimado[m][a] = (estimado[m][a] || 0) + b.est[m][a] }
      }
    }
    const tot = (o, m) => areas.reduce((x, a) => x + (o[m]?.[a] || 0), 0)
    return { proyectado, estimado, tot }
  }

  const doce = rangoMeses(hoy, sumarMeses(hoy, 11))
  const todosMeses = [...new Set(datos.proyecciones.map(f => f.mes))].sort()
  const pasados = todosMeses.length && todosMeses[0] < hoy ? rangoMeses(todosMeses[0], sumarMeses(hoy, -1)).reverse() : []

  const filtros = (
    <div className="card mb-md filtros-proy">
      <input type="search" placeholder="Buscar proyecto, cliente o responsable…" value={buscar} onChange={e => setBuscar(e.target.value)} style={{ fontSize: 13, minWidth: 240 }} />
      <select value={estado} onChange={e => setEstado(e.target.value)} style={{ fontSize: 13 }}>
        {['Todos', 'Activo', 'Pausado', 'Inactivo', 'Terminado', 'Cancelado'].map(s => <option key={s} value={s}>{s === 'Todos' ? 'Todos los estados' : `Proyectos ${s.toLowerCase()}s`}</option>)}
      </select>
      <select value={area} onChange={e => setArea(e.target.value)} style={{ fontSize: 13 }}>
        <option value="Todas">Todas las áreas</option>
        {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
      <label><input type="checkbox" checked={soloMios} onChange={e => setSoloMios(e.target.checked)} /> Solo mis proyectos</label>
      {tab !== 'anio' && <label><input type="checkbox" checked={agrupar} onChange={e => setAgrupar(e.target.checked)} /> Agrupar por responsable</label>}
    </div>
  )

  const kpisMes = (m, conEstimado) => {
    const { proyectado, estimado, tot } = sumas([m])
    const total = tot(proyectado, m), est = tot(estimado, m)
    const nProy = base.filter(b => b.filas.some(f => f.mes === m)).length
    const nSin = base.reduce((s, b) => s + b.filas.filter(f => f.mes === m && sinMonto(f)).length, 0)
    return (
      <div className="kpis-proy">
        <div className="stat-box"><div className="stat-label">Proyectado {textoMes(m)}</div><div className="stat-value green">{fmtMoney(total)}</div><div className="stat-sub">{nProy} proyectos{nSin ? ` · ${nSin} conceptos sin monto` : ''}</div></div>
        {conEstimado
          ? <div className="stat-box"><div className="stat-label">Estimado (enviado)</div><div className="stat-value">{fmtMoney(est)}</div><div className="stat-sub">{total > 0 ? `${Math.round((est / total) * 100)}% de lo proyectado` : '—'}</div></div>
          : <div className="stat-box"><div className="stat-label">Congelamiento</div><div className="stat-value" style={{ fontSize: 18 }}>{estaCongelada(m) ? '🔒 Congelada' : `Abierta hasta el ${textoCongelamiento(m)}`}</div><div className="stat-sub">{estaCongelada(m) ? `desde el ${textoCongelamiento(m)}: ya no se cambia` : 'el día 15 (o el siguiente hábil) se congela'}</div></div>}
        {areas.map(a => <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Punto area={a} />{a}</div><div className="stat-value">{fmtMoney(proyectado[m]?.[a] || 0)}</div><div className="stat-sub">{conEstimado ? `estimado ${fmtMoney(estimado[m]?.[a] || 0)}` : total > 0 ? `${Math.round(((proyectado[m]?.[a] || 0) / total) * 100)}% del mes` : '—'}</div></div>)}
      </div>
    )
  }

  // ── Por mes ──
  const vistaMes = (
    <>
      <div className="selector-mes">
        <button className="btn btn-sm btn-outline" disabled={mes <= hoy} onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">‹</button>
        <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
          {doce.map(m => <option key={m} value={m}>{textoMes(m)}{estaCongelada(m) ? ' 🔒' : ''}{m === hoy ? ' (este mes)' : ''}</option>)}
        </select>
        <button className="btn btn-sm btn-outline" disabled={mes >= doce.at(-1)} onClick={() => setMes(sumarMeses(mes, 1))} aria-label="Mes siguiente">›</button>
        <span className="ayuda">Mes de la estimación · se factura en {textoMes(sumarMeses(mes, 1))}{mes === hoy ? ' · ✓ marca lo que ya se estimó' : ''}</span>
      </div>
      {filtros}
      {kpisMes(mes, false)}
      {listaDelMes(mes, false)}
      {sinProyeccion(mes)}
    </>
  )

  // ── 12 meses ──
  const vistaAnio = (() => {
    const { proyectado, estimado, tot } = sumas(doce)
    const totalArea = Object.fromEntries(areas.map(a => [a, doce.reduce((x, m) => x + (proyectado[m]?.[a] || 0), 0)]))
    const total = Object.values(totalArea).reduce((x, v) => x + v, 0)
    const filas = base.map(b => ({ b, porMes: Object.fromEntries(doce.map(m => [m, totalDe(b, m)])), sin: Object.fromEntries(doce.map(m => [m, b.filas.some(f => f.mes === m && sinMonto(f))])) }))
      .map(x => ({ ...x, total: Object.values(x.porMes).reduce((s, v) => s + v, 0) })).filter(x => x.total > 0 || Object.values(x.sin).some(Boolean)).sort((a, b) => b.total - a.total)
    const max = Math.max(1, ...filas.flatMap(x => Object.values(x.porMes)))
    const ir = (b, m) => { setMes(m); setBuscar(b.p.name.split(/[-_ ]/)[0]); setTab('mes'); window.scrollTo(0, 0) }
    return (
      <>
        {filtros}
        <div className="kpis-proy">
          <div className="stat-box"><div className="stat-label">Proyectado {textoMesCorto(doce[0])} – {textoMesCorto(doce.at(-1))}</div><div className="stat-value green">{fmtMoney(total)}</div><div className="stat-sub">{filas.length} proyectos</div></div>
          {areas.map(a => <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Punto area={a} />{a}</div><div className="stat-value">{fmtMoney(totalArea[a])}</div><div className="stat-sub">{total > 0 ? `${Math.round((totalArea[a] / total) * 100)}% del total` : '—'}</div></div>)}
        </div>
        <div className="card mb-md">
          <div className="section-header"><span className="section-title">Proyección por mes</span><span className="ayuda">🔒 Cada mes se congela el día 15 (o el siguiente día hábil)</span></div>
          <GraficaProyecciones meses={doce} proyectado={proyectado} estimado={estimado} areas={areas} hoy={hoy} />
        </div>
        <div className="card">
          <div className="section-header"><span className="section-title">Por proyecto</span><span className="ayuda">Clic en un mes para ver sus conceptos · ◌ = hay conceptos sin monto</span></div>
          <div className="table-wrap">
            <table style={{ fontSize: 12 }} className="tabla-anio">
              <thead><tr><th style={{ minWidth: 260 }}>Proyecto</th>{doce.map(m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined }}>{textoMesCorto(m)}{estaCongelada(m) ? ' 🔒' : ''}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                {filas.map(({ b, porMes, sin, total: t }) => (
                  <tr key={b.p.id}>
                    <td><a className="nombre" onClick={abrir(b.p)}>{b.p.name}</a><div className="sub">{b.lider || 'Sin líder'}</div></td>
                    {doce.map(m => (
                      <td key={m} className="num celda" onClick={() => (porMes[m] || sin[m]) && ir(b, m)}
                        style={{ background: porMes[m] ? `rgba(42,120,214,${0.08 + 0.42 * (porMes[m] / max)})` : undefined, cursor: porMes[m] || sin[m] ? 'pointer' : undefined }}
                        title={porMes[m] || sin[m] ? `Ver ${textoMes(m)}` : undefined}>
                        {corto(porMes[m])}{sin[m] && <span className="marca-sin" title="Hay conceptos sin monto">◌</span>}
                      </td>
                    ))}
                    <td className="num" style={{ fontWeight: 700 }}>{corto(t)}</td>
                  </tr>
                ))}
                <tr className="fila-total"><td>Total</td>{doce.map(m => <td key={m} className="num">{corto(tot(proyectado, m))}</td>)}<td className="num">{corto(total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  })()

  // ── Baúl ──
  const vistaBaul = (() => {
    const nombreProy = Object.fromEntries(datos.projects.map(p => [p.id, p.name]))
    const visibles = new Set(base.map(b => b.p.id))
    const hist = (historial || []).filter(h => visibles.has(h.project_id) && areas.includes(h.area))
    const textoConcepto = h => { const i = h.concept_id && datos.conceptos.get(h.concept_id); return i ? `${i.c.key} ${i.c.description || ''}` : h.descripcion || '—' }

    let cuerpo
    if (seccion === 'pasados') {
      const { proyectado, estimado, tot } = sumas([...pasados].reverse())
      const conDatos = new Set(base.flatMap(b => Object.entries(b.est).filter(([, v]) => Object.values(v).some(x => x > 0)).map(([m]) => m)))
      cuerpo = !pasados.length ? <div className="empty-state"><h3>Todavía no hay meses pasados</h3></div> : (
        <>
          <div className="card mb-md">
            <div className="section-header"><span className="section-title">Proyectado (congelado) contra estimado</span><span className="ayuda">La línea es lo que se estimó de verdad en el mes</span></div>
            <GraficaProyecciones meses={[...pasados].reverse()} proyectado={proyectado} estimado={estimado} areas={areas} hoy={hoy} />
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table style={{ fontSize: 12 }}>
                <thead><tr><th />{[...pasados].reverse().map(m => <th key={m} className="num">{textoMesCorto(m)}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Proyectado</td>{[...pasados].reverse().map(m => <td key={m} className="num">{corto(tot(proyectado, m))}</td>)}</tr>
                  <tr><td>Estimado</td>{[...pasados].reverse().map(m => <td key={m} className="num" style={{ color: conDatos.has(m) ? undefined : 'var(--text-soft)' }}>{conDatos.has(m) ? corto(tot(estimado, m)) || '$0' : 'sin datos'}</td>)}</tr>
                  <tr style={{ color: 'var(--text-muted)' }}><td>Cumplimiento</td>{[...pasados].reverse().map(m => <td key={m} className="num">{conDatos.has(m) && tot(proyectado, m) > 0 ? `${Math.round((tot(estimado, m) / tot(proyectado, m)) * 100)}%` : ''}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div className="ayuda" style={{ marginTop: 6 }}>"Sin datos": meses sin estimaciones por mes en la app (la migración cargó lo cobrado acumulado). Montos en MXN y USD sumados tal cual.</div>
          </div>
          <div className="selector-mes">
            <select value={mesBaul} onChange={e => setMesBaul(e.target.value)} aria-label="Mes pasado">
              {pasados.map(m => <option key={m} value={m}>{textoMes(m)} 🔒</option>)}
            </select>
            <span className="ayuda">Congelada desde el {textoCongelamiento(mesBaul)} · por concepto: ✓ se estimó en el mes · ✗ no se estimó</span>
          </div>
          {kpisMes(mesBaul, true)}
          {listaDelMes(mesBaul, true)}
        </>
      )
    } else if (seccion === 'versiones') {
      const opciones = [...new Set([...pasados, ...doce])].sort().reverse()
      const vs = historial ? versionesDelMes(hist, mesVersiones) : []
      const congela = iso(fechaCongelamiento(mesVersiones))
      // La proyección vigente justo antes del día del congelamiento (lo del Excel 2026 se cargó después: cuenta su carga)
      const antesDe = [...vs].reverse().find(v => v.dia < congela)
      const alCongelar = estaCongelada(mesVersiones) ? antesDe || vs[0] : null
      cuerpo = (
        <>
          <div className="selector-mes">
            <select value={mesVersiones} onChange={e => setMesVersiones(e.target.value)} aria-label="Mes proyectado">
              {opciones.map(m => <option key={m} value={m}>{textoMes(m)}{estaCongelada(m) ? ' 🔒' : ''}</option>)}
            </select>
            <span className="ayuda">Cómo fue cambiando lo proyectado para este mes, día por día</span>
          </div>
          {!historial ? <div className="spinner" /> : !vs.length ? <div className="empty-state"><h3>Sin movimientos para {textoMes(mesVersiones)}</h3></div> : (
            <div className="card">
              {estaCongelada(mesVersiones) && <div className="aviso-congelado">🔒 Al congelarse ({fechaTxt(congela)}) quedaron <strong>{fmtMoney(alCongelar?.total || 0)}</strong> proyectados{alCongelar?.sinMonto ? ` y ${alCongelar.sinMonto} conceptos sin monto` : ''}{!antesDe ? ' (cargados del Excel 2026 después del congelamiento)' : ''}. Eso es lo que cuenta para los indicadores.</div>}
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead><tr><th>Día</th><th className="num">Proyectado ese día</th><th className="num">Cambio</th><th className="num">Sin monto</th><th>Qué pasó</th></tr></thead>
                  <tbody>
                    {[...vs].reverse().map((v, i, arr) => {
                      const antes = arr[i + 1]?.total || 0
                      const quienes = [...new Set(v.cambios.map(h => nombre(h.hecho_por)))].join(', ')
                      const n = c => v.cambios.filter(h => h.accion === c).length
                      const partes = [n('alta') && `${n('alta')} ${n('alta') === 1 ? 'alta' : 'altas'}`, n('cambio') && `${n('cambio')} ${n('cambio') === 1 ? 'cambio' : 'cambios'}`, n('baja') && `${n('baja')} ${n('baja') === 1 ? 'baja' : 'bajas'}`].filter(Boolean).join(' · ')
                      const esCongelada = v === alCongelar
                      return (
                        <tr key={v.dia} style={esCongelada ? { background: '#EEF6F1' } : undefined}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fechaTxt(v.dia)}{esCongelada && ' 🔒'}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(v.total)}</td>
                          <td className="num" style={{ color: v.total - antes > 0 ? 'var(--green-dark)' : v.total - antes < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{i === arr.length - 1 ? '' : `${v.total - antes >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v.total - antes))}`}</td>
                          <td className="num">{v.sinMonto || ''}</td>
                          <td style={{ fontSize: 11 }}>{partes} <span style={{ color: 'var(--text-muted)' }}>· {quienes}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )
    } else {
      const lista = hist.filter(h => (!mesHist || h.mes === mesHist || h.mes_antes === mesHist) && (conCarga || h.origen !== 'excel' || h.accion !== 'alta')).reverse()
      const opciones = [...new Set(hist.map(h => h.mes))].sort().reverse()
      const que = h => {
        const m = v => (v == null ? '' : fmtMoney(v))
        const monto = (v, t) => (t && !(+v > 0) ? 'sin monto' : m(v))
        if (h.accion === 'alta') return <>Proyectó <strong>{monto(h.monto, h.tbd)}</strong> para {textoMes(h.mes)}</>
        if (h.accion === 'baja') return <>Quitó lo proyectado para {textoMes(h.mes_antes || h.mes)} ({monto(h.monto_antes, h.tbd_antes)})</>
        const partes = []
        if (h.mes_antes && h.mes_antes !== h.mes) partes.push(<Fragment key="m">Lo movió de {textoMes(h.mes_antes)} a <strong>{textoMes(h.mes)}</strong></Fragment>)
        if (+h.monto_antes !== +h.monto || h.tbd_antes !== h.tbd) partes.push(<Fragment key="v">{partes.length ? ' · ' : ''}{monto(h.monto_antes, h.tbd_antes)} → <strong>{monto(h.monto, h.tbd)}</strong></Fragment>)
        return partes.length ? partes : 'Cambió la descripción o el área'
      }
      cuerpo = (
        <>
          <div className="selector-mes">
            <select value={mesHist} onChange={e => { setMesHist(e.target.value); setLimite(200) }} aria-label="Mes proyectado">
              <option value="">Todos los meses</option>
              {opciones.map(m => <option key={m} value={m}>{textoMes(m)}</option>)}
            </select>
            <label className="ayuda" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={conCarga} onChange={e => setConCarga(e.target.checked)} /> Incluir la carga inicial del Excel 2026</label>
          </div>
          {!historial ? <div className="spinner" /> : !lista.length ? <div className="empty-state"><h3>Sin cambios registrados con estos filtros</h3><p>Desde ahora, cada proyección que se agregue, cambie o quite en la app queda aquí.</p></div> : (
            <div className="card">
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead><tr><th>Cuándo</th><th>Quién</th><th>Proyecto</th><th>Concepto</th><th>Qué pasó</th></tr></thead>
                  <tbody>
                    {lista.slice(0, limite).map(h => (
                      <tr key={h.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fechaTxt(h.hecho_en)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{nombre(h.hecho_por)}</td>
                        <td style={{ maxWidth: 240 }}>{nombreProy[h.project_id]}</td>
                        <td style={{ maxWidth: 280 }}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Punto area={h.area} />{textoConcepto(h)}</span></td>
                        <td>{que(h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lista.length > limite && <button className="btn btn-sm btn-outline" style={{ marginTop: 8 }} onClick={() => setLimite(l => l + 300)}>Ver más ({lista.length - limite} más)</button>}
            </div>
          )}
        </>
      )
    }
    return (
      <>
        <div className="intro-baul">
          🗂 Aquí se guarda todo lo proyectado: los <strong>meses pasados</strong> tal como quedaron congelados el día 15, y cada <strong>cambio</strong> que se hace en la app a cualquier proyección, también de meses futuros. Sirve para los indicadores: qué se comprometió, qué se estimó y cómo fue cambiando.
        </div>
        <div className="subpestanas">
          {[['pasados', 'Meses pasados'], ['versiones', 'Versiones de un mes'], ['historial', 'Historial de cambios']].map(([k, t]) => (
            <button key={k} className={seccion === k ? 'activa' : ''} onClick={() => setSeccion(k)}>{t}</button>
          ))}
        </div>
        {filtros}
        {cuerpo}
      </>
    )
  })()

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
        {editables.length > 0 && <button className="btn btn-primary" onClick={() => setNueva({ mes: tab === 'mes' ? mes : undefined })}>＋ Agregar proyección</button>}
      </div>
      {nueva && (
        <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && setNueva(null)}>
          <div className="modal-proy">
            <FormProyeccion key={`${nueva.project_id || ''}${nueva.mes || ''}`} proyectos={nueva.project_id ? datos.projects.filter(p => p.id === nueva.project_id) : editables}
              inicial={nueva} proyecciones={datos.proyecciones} titulo="Nueva proyección"
              onGuardado={() => { const m = nueva.mes; setNueva(null); recargar(); if (m && tab === 'mes') setMes(m) }} onCancelar={() => setNueva(null)} />
          </div>
        </div>
      )}
      <div className="pestanas-proy" role="tablist">
        <button role="tab" aria-selected={tab === 'mes'} className={tab === 'mes' ? 'activa' : ''} onClick={() => setTab('mes')}>Por mes<span>qué se va a estimar y sus conceptos</span></button>
        <button role="tab" aria-selected={tab === 'anio'} className={tab === 'anio' ? 'activa' : ''} onClick={() => setTab('anio')}>12 meses<span>{textoMesCorto(doce[0])} – {textoMesCorto(doce.at(-1))}, resumen</span></button>
        <button role="tab" aria-selected={tab === 'baul'} className={tab === 'baul' ? 'activa' : ''} onClick={() => setTab('baul')}>🗂 Baúl de proyecciones<span>pasadas, versiones e historial</span></button>
      </div>
      {tab === 'mes' ? vistaMes : tab === 'anio' ? vistaAnio : vistaBaul}
    </div>
  )
}
