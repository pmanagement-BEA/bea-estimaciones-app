import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchMyAssignments } from '../lib/directorio'
import { toast } from '../components/Toast'
import GraficaProyecciones from '../components/GraficaProyecciones'
import { fmtMoney } from '../utils/format'
import {
  AREAS, COLOR_AREA, mesIso, sumarMeses, textoMes, textoMesCorto, rangoMeses, prepararProyecto, estimadoPorMes, sumarProyecciones,
  estaCongelada, textoCongelamiento,
} from '../lib/proyecciones'


const corto = v => (v ? `$${Math.round(v).toLocaleString('es-MX')}` : '')

/** Vista general: proyección de cobro de la empresa por mes, por área y por proyecto. */
export default function Proyecciones() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [datos, setDatos] = useState(null)
  const [vista, setVista] = useState('proximas') // próximas (12 meses al futuro) o pasadas (archivo)
  const [mesSel, setMesSel] = useState('') // '' = todos los meses de la vista
  const [estado, setEstado] = useState('Activo')
  const [area, setArea] = useState('Todas')
  const [porArea, setPorArea] = useState(false)
  const [soloMios, setSoloMios] = useState(false)
  const [mios, setMios] = useState({})
  const hoy = mesIso(new Date())

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('*, disciplines (*, concepts(*)), estimations (*, estimation_items(*))'),
      supabase.from('proyecciones').select('project_id, mes, area, monto, tbd'),
    ]).then(([p, pr]) => {
      if (pr.error) toast('Faltan las tablas de proyecciones en la base (migration_2026_11_proyecciones.sql)', true)
      setDatos({ projects: p.data || [], proyecciones: pr.data || [] })
    })
  }, [])
  useEffect(() => { if (profile?.email) fetchMyAssignments(profile.email).then(setMios) }, [profile?.email])

  const todos = useMemo(() => datos ? [...new Set(datos.proyecciones.map(f => f.mes))].sort() : [], [datos])
  // Próximas: este mes y los 11 que siguen (se recorre solo cada mes). Pasadas: desde la primera proyección hasta el mes anterior.
  const opciones = useMemo(() => vista === 'proximas'
    ? rangoMeses(hoy, sumarMeses(hoy, 11))
    : (todos.length && todos[0] < hoy ? rangoMeses(todos[0], sumarMeses(hoy, -1)).reverse() : []), [vista, todos, hoy])
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
      const d = prepararProyecto(p)
      const est = estimadoPorMes(p, d.disciplines, d.estimations)
      const s = sumarProyecciones(pr)
      if (!pr.length) continue
      out.push({ p, s, est })
    }
    return out.sort((a, b) => b.s.total - a.s.total)
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

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span><span className="current">Proyecciones</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Proyecciones <span style={{ color: 'var(--green-dark)' }}>de cobro</span></h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Lo que cada proyecto piensa estimar, por mes de la estimación (se factura al mes siguiente)</div>
        </div>
      </div>

      <div className="card mb-md" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px' }}>
        <div className="flex gap-sm">
          <button className={`btn btn-sm ${vista === 'proximas' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setVista('proximas'); setMesSel('') }}>Próximas</button>
          <button className={`btn btn-sm ${vista === 'pasadas' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setVista('pasadas'); setMesSel('') }}>Proyecciones pasadas</button>
        </div>
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
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={porArea} onChange={e => setPorArea(e.target.checked)} /> Desglosar por área</label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="stat-box"><div className="stat-label">{pasadas ? 'Proyectado (congelado)' : 'Total proyectado'}</div><div className="stat-value green">{fmtMoney(total)}</div><div className="stat-sub">{meses.length ? (meses.length === 1 ? textoMes(meses[0]) : `${textoMesCorto(meses[0])} – ${textoMesCorto(meses.at(-1))}`) : 'sin meses pasados'} · {filas.length} proyectos</div></div>
        {pasadas
          ? <div className="stat-box"><div className="stat-label">Estimado (enviado)</div><div className="stat-value">{fmtMoney(totalEst)}</div><div className="stat-sub">{mesesConDatos.length ? `cumplimiento ${pct(totalEst, proyConDatos)} (${mesesConDatos.length === meses.length ? 'todos los meses' : `en ${mesesConDatos.length} ${mesesConDatos.length === 1 ? 'mes con datos' : 'meses con datos'}`})` : 'sin estimaciones por mes en estos meses'}</div></div>
          : <div className="stat-box"><div className="stat-label">{textoMes(hoy)}{estaCongelada(hoy) ? ' 🔒' : ''}</div><div className="stat-value">{fmtMoney(mesActual)}</div><div className="stat-sub">{estaCongelada(hoy) ? `congelada desde el ${textoCongelamiento(hoy)}` : `se congela el ${textoCongelamiento(hoy)}`}</div></div>}
        {areas.map(a => (
          <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</div><div className="stat-value">{fmtMoney(totalArea[a])}</div><div className="stat-sub">{pasadas ? `estimado ${fmtMoney(estArea[a])}${mesesConDatos.length ? ` · ${pct(estArea[a], proyAreaConDatos(a))}` : ''}` : total > 0 ? `${Math.round((totalArea[a] / total) * 100)}% del total` : '—'}</div></div>
        ))}
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">{pasadas ? 'Proyectado (congelado) contra estimado' : 'Proyección por mes'}</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔒 Cada mes se congela el día 15 (o el siguiente día hábil)</span></div>
        <GraficaProyecciones meses={meses} proyectado={proyectado} estimado={estimado} areas={areas} hoy={hoy} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Montos en MXN y USD sumados tal cual. Lo estimado no cuenta la estimación de arranque de cada proyecto migrado, porque trae todo lo cobrado antes.</div>
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">Total por área y mes</span>{pasadas && meses.some(m => !conDatos(m)) && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>"Sin datos": meses sin estimaciones por mes en la app (la migración cargó lo cobrado acumulado)</span>}</div>
        <div className="table-wrap">
          <table style={{ fontSize: 12 }}>
            <thead><tr><th>Área</th>{meses.map(m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined }} title={estaCongelada(m) ? `Congelada desde el ${textoCongelamiento(m)}` : `Se congela el ${textoCongelamiento(m)}`}>{textoMesCorto(m)}{estaCongelada(m) ? ' 🔒' : ''}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {areas.map(a => (
                <tr key={a}><td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</span></td>
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
        <div className="section-header"><span className="section-title">Por proyecto</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clic en el proyecto para ver o capturar sus proyecciones</span></div>
        {filas.length === 0 ? <div className="empty-state"><h3>Sin proyecciones con estos filtros</h3></div> : (
          <div className="table-wrap">
            <table style={{ fontSize: 12 }}>
              <thead><tr><th style={{ minWidth: 220 }}>Proyecto</th>{porArea && <th>Área</th>}{meses.map(m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined }} title={estaCongelada(m) ? `Congelada desde el ${textoCongelamiento(m)}` : `Se congela el ${textoCongelamiento(m)}`}>{textoMesCorto(m)}{estaCongelada(m) ? ' 🔒' : ''}</th>)}<th className="num">Total</th>{pasadas && <><th className="num">Estimado</th><th className="num">Cumpl.</th></>}</tr></thead>
              <tbody>
                {filas.flatMap(({ p, s, est }) => {
                  const estDe = a => meses.reduce((x, m) => x + (a ? est[m]?.[a] || 0 : areas.reduce((y, k) => y + (est[m]?.[k] || 0), 0)), 0)
                  const nombre = <a style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate(`/projects/${p.id}/proyecciones`)}>{p.name}</a>
                  if (!porArea) return [(
                    <tr key={p.id}><td>{nombre}{p.currency === 'USD' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-soft)' }}>USD</span>}</td>
                      {meses.map(m => <td key={m} className="num">{corto(delMes(s, m))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.total)}</td>
                      {pasadas && <><td className="num">{corto(estDe())}</td><td className="num" style={{ color: 'var(--text-muted)' }}>{mesesConDatos.length ? pct(estDe(), mesesConDatos.reduce((x, m) => x + delMes(s, m), 0)) : '—'}</td></>}</tr>
                  )]
                  const conArea = areas.filter(a => s.porArea[a] > 0)
                  return conArea.map((a, i) => (
                    <tr key={p.id + a} style={i === conArea.length - 1 ? undefined : { borderBottom: 0 }}>
                      <td>{i === 0 ? nombre : null}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</span></td>
                      {meses.map(m => <td key={m} className="num">{corto(delMes(s, m, a))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.porArea[a])}</td>
                      {pasadas && <><td className="num">{corto(estDe(a))}</td><td className="num" style={{ color: 'var(--text-muted)' }}>{mesesConDatos.length ? pct(estDe(a), mesesConDatos.reduce((x, m) => x + delMes(s, m, a), 0)) : '—'}</td></>}
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
