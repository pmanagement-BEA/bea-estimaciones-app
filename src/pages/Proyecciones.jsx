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
} from '../lib/proyecciones'

const RANGOS = [
  ['proximos', 'Próximos 12 meses'],
  ['anio', 'Este año'],
  ['todo', 'Todo'],
]

const corto = v => (v ? `$${Math.round(v).toLocaleString('es-MX')}` : '')

/** Vista general: proyección de cobro de la empresa por mes, por área y por proyecto. */
export default function Proyecciones() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [datos, setDatos] = useState(null)
  const [rango, setRango] = useState('proximos')
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
  const meses = useMemo(() => {
    if (rango === 'proximos') return rangoMeses(hoy, sumarMeses(hoy, 11))
    if (rango === 'anio') return rangoMeses(`${hoy.slice(0, 4)}-01`, `${hoy.slice(0, 4)}-12`)
    return todos.length ? rangoMeses(todos[0] < hoy ? todos[0] : hoy, todos.at(-1) > hoy ? todos.at(-1) : hoy) : [hoy]
  }, [rango, todos, hoy])

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
  const delMes = (s, m, a) => (a ? s.porMes[m]?.[a] || 0 : areas.reduce((x, k) => x + (s.porMes[m]?.[k] || 0), 0))
  const totalMes = m => areas.reduce((x, a) => x + (proyectado[m]?.[a] || 0), 0)

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
        <div className="flex gap-sm">{RANGOS.map(([k, t]) => <button key={k} className={`btn btn-sm ${rango === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRango(k)}>{t}</button>)}</div>
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
        <div className="stat-box"><div className="stat-label">Total proyectado</div><div className="stat-value green">{fmtMoney(total)}</div><div className="stat-sub">{textoMesCorto(meses[0])} – {textoMesCorto(meses.at(-1))} · {filas.length} proyectos</div></div>
        <div className="stat-box"><div className="stat-label">{textoMes(hoy)}</div><div className="stat-value">{fmtMoney(mesActual)}</div><div className="stat-sub">estimaciones de este mes</div></div>
        {areas.map(a => (
          <div key={a} className="stat-box"><div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</div><div className="stat-value">{fmtMoney(totalArea[a])}</div><div className="stat-sub">{total > 0 ? `${Math.round((totalArea[a] / total) * 100)}% del total` : '—'}</div></div>
        ))}
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">Proyección por mes</span></div>
        <GraficaProyecciones meses={meses} proyectado={proyectado} estimado={estimado} areas={areas} hoy={hoy} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Montos en MXN y USD sumados tal cual. Lo estimado no cuenta la estimación de arranque de cada proyecto migrado, porque trae todo lo cobrado antes.</div>
      </div>

      <div className="card mb-md">
        <div className="section-header"><span className="section-title">Total por área y mes</span></div>
        <div className="table-wrap">
          <table style={{ fontSize: 12 }}>
            <thead><tr><th>Área</th>{meses.map(m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined }}>{textoMesCorto(m)}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {areas.map(a => (
                <tr key={a}><td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</span></td>
                  {meses.map(m => <td key={m} className="num">{corto(proyectado[m]?.[a])}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(totalArea[a])}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Total</td>{meses.map(m => <td key={m} className="num">{corto(totalMes(m))}</td>)}<td className="num">{corto(total)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-header"><span className="section-title">Por proyecto</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clic en el proyecto para ver o capturar sus proyecciones</span></div>
        {filas.length === 0 ? <div className="empty-state"><h3>Sin proyecciones con estos filtros</h3></div> : (
          <div className="table-wrap">
            <table style={{ fontSize: 12 }}>
              <thead><tr><th style={{ minWidth: 220 }}>Proyecto</th>{porArea && <th>Área</th>}{meses.map(m => <th key={m} className="num" style={{ color: m === hoy ? 'var(--green-dark)' : undefined }}>{textoMesCorto(m)}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                {filas.flatMap(({ p, s }) => {
                  const nombre = <a style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate(`/projects/${p.id}/proyecciones`)}>{p.name}</a>
                  if (!porArea) return [(
                    <tr key={p.id}><td>{nombre}{p.currency === 'USD' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-soft)' }}>USD</span>}</td>
                      {meses.map(m => <td key={m} className="num">{corto(delMes(s, m))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.total)}</td></tr>
                  )]
                  const conArea = areas.filter(a => s.porArea[a] > 0)
                  return conArea.map((a, i) => (
                    <tr key={p.id + a} style={i === conArea.length - 1 ? undefined : { borderBottom: 0 }}>
                      <td>{i === 0 ? nombre : null}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</span></td>
                      {meses.map(m => <td key={m} className="num">{corto(delMes(s, m, a))}</td>)}<td className="num" style={{ fontWeight: 700 }}>{corto(s.porArea[a])}</td>
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
