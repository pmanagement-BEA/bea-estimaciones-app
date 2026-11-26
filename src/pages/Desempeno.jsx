import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtMoney } from '../utils/format'
import { puedeVerDesempeno, cargarDesempeno, calcularDesempeno, AREAS } from '../lib/desempeno'
import { COLOR_AREA, textoMes, textoMesCorto, mesIso, nombreCorto } from '../lib/proyecciones'
import { num } from '../lib/track'

const REFRESCO_MS = 5 * 60 * 1000
const VISTAS = [['general', 'General'], ['area', 'Por área'], ['individual', 'Individual']]

// ── Formatos ────────────────────────────────────────────────────────────────
const dinero = (n, moneda = 'MXN') => fmtMoney(Math.round(n || 0), moneda).replace(/\.00$/, '')
/** { MXN, USD } → "$1,234 + USD 500" */
function mon(o = {}) {
  const partes = []
  if (o.MXN || !o.USD) partes.push(dinero(o.MXN || 0, 'MXN'))
  if (o.USD) partes.push(dinero(o.USD, 'USD'))
  return partes.join(' + ')
}
const pct = (n, dec = 0) => (n === null || n === undefined || isNaN(n) ? '—' : `${num(n, dec)}%`)
const hrs = (n, dec = 0) => `${num(n || 0, dec)} h`
const semaforo = (v, bien, regular) => (v === null || v === undefined ? '' : v >= bien ? 'ok' : v >= regular ? 'medio' : 'mal')

// ── Piezas ──────────────────────────────────────────────────────────────────
function Kpi({ etiqueta, valor, sub, tono }) {
  return (
    <div className={`stat-box dsp-kpi ${tono || ''}`}>
      <div className="stat-label">{etiqueta}</div>
      <div className="stat-value">{valor}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function Barra({ valor, max = 100, color }) {
  const w = Math.max(0, Math.min(100, (valor || 0) / (max || 1) * 100))
  return <span className="dsp-barra"><span style={{ width: `${w}%`, background: color || 'var(--green)' }} /></span>
}

/** Proyectado vs cobrado (MXN) por mes, barras lado a lado */
function GraficaCobro({ tendencia, moneda = 'MXN' }) {
  const max = Math.max(1, ...tendencia.map(t => Math.max(t.cobrado[moneda] || 0, t.proyectado[moneda] || 0)))
  const W = 720, Hh = 180, pad = 26, ancho = (W - pad) / tendencia.length
  return (
    <svg className="dsp-grafica" viewBox={`0 0 ${W} ${Hh + 22}`} role="img" aria-label={`Proyectado contra cobrado por mes en ${moneda}`}>
      {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={pad} x2={W} y1={Hh - f * Hh + 4} y2={Hh - f * Hh + 4} className="dsp-guia" />)}
      {tendencia.map((t, i) => {
        const x = pad + i * ancho, bw = Math.min(16, ancho / 3)
        const hp = (t.proyectado[moneda] || 0) / max * Hh, hc = (t.cobrado[moneda] || 0) / max * Hh
        return (
          <g key={t.mes}>
            <rect x={x + ancho / 2 - bw - 1} y={Hh - hp + 4} width={bw} height={hp} rx="2" className="dsp-b-proy"><title>{`${textoMes(t.mes)} · proyectado ${dinero(t.proyectado[moneda], moneda)}`}</title></rect>
            <rect x={x + ancho / 2 + 1} y={Hh - hc + 4} width={bw} height={hc} rx="2" className="dsp-b-cob"><title>{`${textoMes(t.mes)} · cobrado ${dinero(t.cobrado[moneda], moneda)}`}</title></rect>
            <text x={x + ancho / 2} y={Hh + 18} textAnchor="middle" className="dsp-eje">{textoMesCorto(t.mes)}</text>
          </g>
        )
      })}
      <text x={pad - 4} y={12} textAnchor="end" className="dsp-eje">{num(max / 1000)}k</text>
    </svg>
  )
}

/** Horas por mes: directas + indirectas apiladas */
function GraficaHoras({ tendencia }) {
  const max = Math.max(1, ...tendencia.map(t => t.horas))
  const W = 720, Hh = 120, pad = 26, ancho = (W - pad) / tendencia.length
  return (
    <svg className="dsp-grafica" viewBox={`0 0 ${W} ${Hh + 22}`} role="img" aria-label="Horas registradas por mes">
      {tendencia.map((t, i) => {
        const x = pad + i * ancho, bw = Math.min(26, ancho * 0.6)
        const hd = (t.horas - t.indirectas) / max * Hh, hi = t.indirectas / max * Hh
        return (
          <g key={t.mes}>
            <rect x={x + (ancho - bw) / 2} y={Hh - hd - hi + 4} width={bw} height={hi} className="dsp-b-ind"><title>{`${textoMes(t.mes)} · indirectas ${hrs(t.indirectas)}`}</title></rect>
            <rect x={x + (ancho - bw) / 2} y={Hh - hd + 4} width={bw} height={hd} className="dsp-b-dir"><title>{`${textoMes(t.mes)} · directas ${hrs(t.horas - t.indirectas)}`}</title></rect>
            <text x={x + ancho / 2} y={Hh + 18} textAnchor="middle" className="dsp-eje">{textoMesCorto(t.mes)}</text>
          </g>
        )
      })}
      <text x={pad - 4} y={12} textAnchor="end" className="dsp-eje">{num(max)}</text>
    </svg>
  )
}

function Leyenda({ items }) {
  return <div className="dsp-leyenda">{items.map(([c, t]) => <span key={t}><i className={c} />{t}</span>)}</div>
}

function TablaProyectos({ filas, area, onAbrir }) {
  if (!filas.length) return <p className="dsp-vacio">Sin proyectos activos.</p>
  return (
    <div className="dsp-tabla-wrap">
      <table className="dsp-tabla">
        <thead><tr>
          <th>Proyecto</th><th>Líder</th><th className="n">Avance</th><th className="n">Proyectado mes</th><th className="n">Cobrado mes</th>
          <th className="n">Horas reales / est.</th><th className="n" title="(avance × horas estimadas) ÷ horas reales; arriba de 100% va mejor que lo planeado">Eficiencia</th>
          <th className="n" title="Lo cobrado acumulado ÷ horas reales">$/h</th><th>Término proyectado</th>
        </tr></thead>
        <tbody>
          {filas.map(x => {
            const avance = area ? x.areaAvance?.[area]?.pct ?? null : x.avance
            const proy = area ? x.proyectadoMes[area] || 0 : x.proyectadoMesTotal
            const cob = area ? x.cobradoMes[area] || 0 : x.cobradoMesTotal
            const ef = x.eficiencia === null ? null : x.eficiencia * 100
            return (
              <tr key={x.p.id}>
                <td><a className="dsp-link" onClick={() => onAbrir(x.p)}>{x.p.name}</a>{!x.ligado && <span className="dsp-tag" title="Sin proyecto ligado en Track">sin horas</span>}</td>
                <td className="sub">{x.lider || '—'}</td>
                <td className="n"><Barra valor={avance} /> {pct(avance)}</td>
                <td className="n">{proy ? dinero(proy, x.moneda) : '—'}</td>
                <td className={`n ${proy > 0 ? semaforo(cob / proy * 100, 95, 60) : ''}`}>{cob ? dinero(cob, x.moneda) : '—'}</td>
                <td className="n">{x.horasReales ? hrs(x.horasReales) : '—'}{x.horasEstimadas ? <span className="sub"> / {hrs(x.horasEstimadas)}</span> : null}</td>
                <td className={`n ${semaforo(ef, 100, 80)}`}>{pct(ef)}</td>
                <td className="n">{x.porHora ? dinero(x.porHora, x.moneda) : '—'}</td>
                <td>{x.termino ? textoMes(x.termino) : <span className="sub">{x.porEstimar > 0.5 ? 'Sin proyección' : 'Cobrado'}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TablaAtrasos({ atrasos, onAbrir }) {
  if (!atrasos.length) return <p className="dsp-vacio">Nada atrasado: todo lo proyectado en meses pasados ya se cobró.</p>
  return (
    <div className="dsp-tabla-wrap">
      <table className="dsp-tabla">
        <thead><tr><th>Proyecto</th><th>Concepto</th><th>Área</th><th>Proyectado para</th><th className="n">Atraso</th><th className="n">Monto proyectado</th></tr></thead>
        <tbody>
          {atrasos.map((a, i) => (
            <tr key={i}>
              <td><a className="dsp-link" onClick={() => onAbrir(a.proyecto)}>{a.proyecto.name}</a></td>
              <td><b>{a.concepto?.key}</b> <span className="sub">{a.concepto?.description}</span></td>
              <td><i className="dsp-punto" style={{ background: COLOR_AREA[a.area] }} />{a.area}</td>
              <td>{textoMes(a.mes)}</td>
              <td className={`n ${a.meses >= 3 ? 'mal' : 'medio'}`}>{a.meses} {a.meses === 1 ? 'mes' : 'meses'}</td>
              <td className="n">{a.sinMonto ? <span className="sub">sin monto</span> : dinero(a.monto, a.moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Alertas({ alertas }) {
  if (!alertas.length) return <p className="dsp-vacio">Sin alertas de captura.</p>
  const grupos = {}
  for (const a of alertas) (grupos[a.tipo] ||= []).push(a)
  return (
    <div className="dsp-alertas">
      {Object.entries(grupos).map(([tipo, lista]) => (
        <div key={tipo} className="dsp-alerta">
          <div><b>{tipo}</b> <span className="dsp-tag">{lista.length}</span></div>
          <ul>{lista.map((a, i) => <li key={i}>{a.texto}</li>)}</ul>
        </div>
      ))}
    </div>
  )
}

function TablaPersonas({ personas, onElegir }) {
  return (
    <div className="dsp-tabla-wrap">
      <table className="dsp-tabla">
        <thead><tr><th>Persona</th><th>Área</th><th className="n">Horas</th><th className="n">Directas</th><th className="n">Indirectas</th><th className="n" title="Horas registradas ÷ (días hábiles × 8 h)">Utilización</th><th className="n">Sin concepto</th></tr></thead>
        <tbody>
          {personas.map(g => (
            <tr key={g.clave}>
              <td><a className="dsp-link" onClick={() => onElegir(g.clave)}>{nombreCorto(g.nombre)}</a></td>
              <td className="sub">{g.area || 'Sin área'}</td>
              <td className="n">{hrs(g.horas, 1)}</td>
              <td className="n">{hrs(g.directas, 1)}</td>
              <td className={`n ${g.horas > 0 && g.pctIndirectas > 40 ? 'mal' : ''}`}>{pct(g.pctIndirectas)}</td>
              <td className={`n ${semaforo(g.utilizacion, 85, 60)}`}><Barra valor={g.utilizacion} max={110} /> {pct(g.utilizacion)}</td>
              <td className={`n ${g.sinConcepto ? 'medio' : ''}`}>{g.sinConcepto || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Seccion({ titulo, sub, children }) {
  return (
    <section className="card dsp-seccion">
      <div className="dsp-seccion-tit"><h3>{titulo}</h3>{sub && <span className="sub">{sub}</span>}</div>
      {children}
    </section>
  )
}

function IssuesLog() {
  return (
    <Seccion titulo="Issues log" sub="Próximamente">
      <p className="dsp-vacio">Aquí se cargará el issues log de cada proyecto (abiertos, cerrados y antigüedad por responsable) para medir el seguimiento de Cx.</p>
    </Seccion>
  )
}

// ── Vistas ──────────────────────────────────────────────────────────────────
function VistaGeneral({ r, onAbrir, onPersona }) {
  const t = r.totales
  return (
    <>
      <div className="summary-grid dsp-kpis">
        <Kpi etiqueta="Cobrado del mes" valor={mon(t.cobrado)} sub={`de ${mon(t.proyectado)} proyectado${r.mes === mesIso(new Date()) ? ' · mes en curso: se cobra al cierre' : ''}`} />
        <Kpi etiqueta="Cumplimiento de proyección" valor={pct(t.cumplimiento)} sub="cobrado ÷ proyectado (MXN)" tono={semaforo(t.cumplimiento, 95, 60)} />
        <Kpi etiqueta="Por estimar" valor={mon(t.porEstimar)} sub={`${t.proyectosActivos} proyectos activos`} />
        <Kpi etiqueta="Proyectos con atraso" valor={t.atrasados} sub={`${r.atrasos.length} conceptos atrasados`} tono={t.atrasados ? 'mal' : 'ok'} />
        <Kpi etiqueta="Horas del mes" valor={hrs(t.horas)} sub={`${t.habiles} días hábiles · ${pct(t.pctIndirectas)} indirectas`} />
        <Kpi etiqueta="Utilización del equipo" valor={pct(t.utilizacion)} sub="horas ÷ (días hábiles × 8 h)" tono={semaforo(t.utilizacion, 85, 60)} />
        <Kpi etiqueta="Cobrado por hora" valor={t.porHora ? dinero(t.porHora) : '—'} sub="cobrado del mes (MXN) ÷ horas" />
        <Kpi etiqueta="Alertas de captura" valor={r.alertas.length} sub="ver detalle abajo" tono={r.alertas.length ? 'medio' : 'ok'} />
      </div>

      <div className="dsp-dos">
        <Seccion titulo="Proyectado vs cobrado" sub="últimos 12 meses · MXN">
          <GraficaCobro tendencia={r.tendencia} />
          <Leyenda items={[['dsp-b-proy', 'Proyectado'], ['dsp-b-cob', 'Cobrado']]} />
        </Seccion>
        <Seccion titulo="Horas del equipo" sub="Toggl + Track">
          <GraficaHoras tendencia={r.tendencia} />
          <Leyenda items={[['dsp-b-dir', 'Directas'], ['dsp-b-ind', 'Indirectas']]} />
        </Seccion>
      </div>

      <Seccion titulo="Por área" sub={textoMes(r.mes)}>
        <div className="dsp-tabla-wrap">
          <table className="dsp-tabla">
            <thead><tr><th>Área</th><th className="n">Proyectado</th><th className="n">Cobrado</th><th className="n">Cumplimiento</th><th className="n">Avance de contratos</th><th className="n">Horas</th><th className="n">Utilización</th><th className="n">Atrasos</th></tr></thead>
            <tbody>
              {r.areas.map(a => (
                <tr key={a.area}>
                  <td><i className="dsp-punto" style={{ background: COLOR_AREA[a.area] }} />{a.area}</td>
                  <td className="n">{mon(a.proyectado)}</td>
                  <td className="n">{mon(a.cobrado)}</td>
                  <td className={`n ${semaforo(a.cumplimiento, 95, 60)}`}>{pct(a.cumplimiento)}</td>
                  <td className="n"><Barra valor={a.avance} color={COLOR_AREA[a.area]} /> {pct(a.avance)}</td>
                  <td className="n">{hrs(a.horas)}</td>
                  <td className={`n ${semaforo(a.utilizacion, 85, 60)}`}>{pct(a.utilizacion)}</td>
                  <td className={`n ${a.atrasos.length ? 'mal' : ''}`}>{a.atrasos.length || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion titulo="Proyectos activos" sub="avance, cobro del mes, horas y eficiencia">
        <TablaProyectos filas={[...r.proyectos].sort((a, b) => b.proyectadoMesTotal - a.proyectadoMesTotal || a.p.name.localeCompare(b.p.name))} onAbrir={onAbrir} />
      </Seccion>
      <Seccion titulo="Atrasos" sub="conceptos cuya última proyección ya pasó y siguen sin cobrar"><TablaAtrasos atrasos={r.atrasos} onAbrir={onAbrir} /></Seccion>
      <Seccion titulo="Equipo" sub={textoMes(r.mes)}><TablaPersonas personas={r.personas.filter(g => g.activo || g.horas)} onElegir={onPersona} /></Seccion>
      <Seccion titulo="Alertas de consistencia y calidad de captura"><Alertas alertas={r.alertas} /></Seccion>
      <IssuesLog />
    </>
  )
}

function VistaArea({ r, area, onAbrir, onPersona }) {
  const a = r.areas.find(x => x.area === area)
  if (!a) return null
  const tendencia = r.tendencia.map(t => {
    const cobrado = {}, proyectado = {}
    for (const x of r.proyectos) {
      if (x.cobradoMeses[t.mes]?.[area]) cobrado[x.moneda] = (cobrado[x.moneda] || 0) + x.cobradoMeses[t.mes][area]
      if (x.proyectadoMeses[t.mes]?.[area]) proyectado[x.moneda] = (proyectado[x.moneda] || 0) + x.proyectadoMeses[t.mes][area]
    }
    const horas = a.personas.reduce((s, g) => s + (g.meses[t.mes]?.total || 0), 0)
    const indirectas = a.personas.reduce((s, g) => s + (g.meses[t.mes]?.indirectas || 0), 0)
    return { mes: t.mes, cobrado, proyectado, horas, indirectas }
  })
  return (
    <>
      <div className="summary-grid dsp-kpis">
        <Kpi etiqueta="Cobrado del mes" valor={mon(a.cobrado)} sub={`de ${mon(a.proyectado)} proyectado`} />
        <Kpi etiqueta="Cumplimiento" valor={pct(a.cumplimiento)} sub="cobrado ÷ proyectado (MXN)" tono={semaforo(a.cumplimiento, 95, 60)} />
        <Kpi etiqueta="Avance de contratos" valor={pct(a.avance)} sub={`${mon(a.acumulado)} de ${mon(a.contratado)}`} />
        <Kpi etiqueta="Atrasos" valor={a.atrasos.length} sub="conceptos proyectados sin cobrar" tono={a.atrasos.length ? 'mal' : 'ok'} />
        <Kpi etiqueta="Horas del mes" valor={hrs(a.horas)} sub={`${a.personas.length} personas · ${pct(a.horas ? a.indirectas / a.horas * 100 : 0)} indirectas`} />
        <Kpi etiqueta="Utilización" valor={pct(a.utilizacion)} sub="horas ÷ capacidad del área" tono={semaforo(a.utilizacion, 85, 60)} />
        <Kpi etiqueta="Cobrado por hora" valor={a.porHora ? dinero(a.porHora) : '—'} sub="cobrado del mes (MXN) ÷ horas del área" />
        <Kpi etiqueta="Proyectos con el área" valor={a.proyectos.length} sub="activos" />
      </div>
      <div className="dsp-dos">
        <Seccion titulo="Proyectado vs cobrado" sub={`${area} · MXN`}><GraficaCobro tendencia={tendencia} /><Leyenda items={[['dsp-b-proy', 'Proyectado'], ['dsp-b-cob', 'Cobrado']]} /></Seccion>
        <Seccion titulo="Horas del área"><GraficaHoras tendencia={tendencia} /><Leyenda items={[['dsp-b-dir', 'Directas'], ['dsp-b-ind', 'Indirectas']]} /></Seccion>
      </div>
      <Seccion titulo="Personas del área" sub={textoMes(r.mes)}><TablaPersonas personas={a.personas} onElegir={onPersona} /></Seccion>
      <Seccion titulo="Proyectos" sub="montos y avance solo de esta área"><TablaProyectos filas={a.proyectos} area={area} onAbrir={onAbrir} /></Seccion>
      <Seccion titulo="Atrasos del área"><TablaAtrasos atrasos={a.atrasos} onAbrir={onAbrir} /></Seccion>
    </>
  )
}

function VistaIndividual({ r, clave, onAbrir }) {
  const g = r.personas.find(x => x.clave === clave)
  if (!g) return <p className="dsp-vacio">Elige a una persona.</p>
  const lider = g.proyectosLider
  const cob = {}, proy = {}
  for (const x of lider) { cob[x.moneda] = (cob[x.moneda] || 0) + x.cobradoMesTotal; proy[x.moneda] = (proy[x.moneda] || 0) + x.proyectadoMesTotal }
  const cumplimiento = (proy.MXN || 0) > 0 ? (cob.MXN || 0) / proy.MXN * 100 : null
  const atrasos = r.atrasos.filter(a => lider.some(x => x.p.id === a.proyecto.id))
  const tendencia = g.tendencia.map(t => ({ ...t, cobrado: {}, proyectado: {} }))
  return (
    <>
      <div className="summary-grid dsp-kpis">
        <Kpi etiqueta="Horas del mes" valor={hrs(g.horas, 1)} sub={`${r.totales.habiles} días hábiles · capacidad ${hrs(r.totales.capacidad)}`} />
        <Kpi etiqueta="Utilización" valor={pct(g.utilizacion)} sub="horas ÷ (días hábiles × 8 h)" tono={semaforo(g.utilizacion, 85, 60)} />
        <Kpi etiqueta="Horas indirectas" valor={pct(g.pctIndirectas)} sub={hrs(g.indirectas, 1)} tono={g.horas && g.pctIndirectas > 40 ? 'mal' : ''} />
        <Kpi etiqueta="Registros sin concepto" valor={g.sinConcepto} sub="en proyectos con contrato" tono={g.sinConcepto ? 'medio' : 'ok'} />
        <Kpi etiqueta="Proyectos como líder" valor={lider.length} sub={`${g.proyectosMiembro.length} en los que participa`} />
        <Kpi etiqueta="Cobrado de sus proyectos" valor={mon(cob)} sub={`de ${mon(proy)} proyectado`} />
        <Kpi etiqueta="Cumplimiento" valor={pct(cumplimiento)} sub="de los proyectos que lidera" tono={semaforo(cumplimiento, 95, 60)} />
        <Kpi etiqueta="Atrasos" valor={atrasos.length} sub="en proyectos que lidera" tono={atrasos.length ? 'mal' : 'ok'} />
      </div>
      <div className="dsp-dos">
        <Seccion titulo="Horas por mes" sub="últimos 12 meses"><GraficaHoras tendencia={tendencia} /><Leyenda items={[['dsp-b-dir', 'Directas'], ['dsp-b-ind', 'Indirectas']]} /></Seccion>
        <Seccion titulo="Dónde se fueron las horas" sub={textoMes(r.mes)}>
          {g.porProyecto.length ? (
            <ul className="dsp-reparto">
              {g.porProyecto.slice(0, 12).map((x, i) => (
                <li key={i}><span className="nombre">{x.tp?.nombre || 'Proyecto'}</span><Barra valor={x.h} max={g.porProyecto[0].h} /><span className="n">{hrs(x.h, 1)}</span></li>
              ))}
            </ul>
          ) : <p className="dsp-vacio">Sin horas registradas en el mes.</p>}
        </Seccion>
      </div>
      <Seccion titulo="Proyectos que lidera"><TablaProyectos filas={lider} onAbrir={onAbrir} /></Seccion>
      <Seccion titulo="Atrasos en sus proyectos"><TablaAtrasos atrasos={atrasos} onAbrir={onAbrir} /></Seccion>
    </>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────
export default function Desempeno() {
  const navigate = useNavigate()
  const [permiso, setPermiso] = useState(null)
  const [mes, setMes] = useState(mesIso(new Date()))
  const [vista, setVista] = useState(() => { try { return localStorage.getItem('dsp_vista') || 'general' } catch { return 'general' } })
  const [area, setArea] = useState(AREAS[0])
  const [clave, setClave] = useState('')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [actualizado, setActualizado] = useState(null)

  useEffect(() => { puedeVerDesempeno().then(setPermiso) }, [])
  useEffect(() => { try { localStorage.setItem('dsp_vista', vista) } catch { /* sin almacenamiento */ } }, [vista])

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try { setDatos(await cargarDesempeno(mes)); setActualizado(new Date()) } catch (e) { setError(e.message || String(e)) }
    setCargando(false)
  }, [mes])

  // En vivo: carga al entrar, cada 5 min y al volver a la pestaña
  useEffect(() => {
    if (!permiso) return
    cargar()
    const t = setInterval(cargar, REFRESCO_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [permiso, cargar])

  const r = useMemo(() => (datos && datos.mes === mes ? calcularDesempeno(datos) : null), [datos, mes])
  useEffect(() => { if (r && !clave && r.personas.length) setClave(r.personas[0].clave) }, [r, clave])
  const onAbrir = p => navigate(`/projects/${p.id}/history`)
  const onPersona = c => { setClave(c); setVista('individual'); window.scrollTo(0, 0) }

  if (permiso === null) return <div className="main"><div className="spinner" /></div>
  if (!permiso) return (
    <div className="main"><div className="empty-state"><h3>Reporte de desempeño</h3><p>Solo lo ven los coordinadores, PMO y Dirección.</p></div></div>
  )

  const persona = r?.personas.find(g => g.clave === clave)
  const tituloVista = vista === 'area' ? area : vista === 'individual' ? (persona ? persona.nombre : '') : 'General'
  return (
    <div className="main dsp">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte de <span className="accent">desempeño</span></h1>
          <div className="page-subtitle">
            {tituloVista} · {textoMes(mes)}
            <span className="dsp-vivo no-print"><i className={cargando ? 'cargando' : ''} />{cargando ? 'Actualizando…' : actualizado ? `En vivo · actualizado ${actualizado.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            <span className="dsp-solo-print"> · generado el {new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
        </div>
        <div className="flex no-print" style={{ gap: 8, alignItems: 'center' }}>
          <input type="month" className="input dsp-mes" value={mes} max={mesIso(new Date())} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes del reporte" />
          <button className="btn btn-outline" onClick={cargar} disabled={cargando}>Actualizar</button>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!r}>Exportar PDF</button>
        </div>
      </div>

      <div className="tabs no-print dsp-tabs">
        {VISTAS.map(([v, t]) => <div key={v} className={`tab${vista === v ? ' active' : ''}`} onClick={() => setVista(v)} role="tab" aria-selected={vista === v}>{t}</div>)}
        <div className="dsp-filtro">
          {vista === 'area' && (
            <select className="input" value={area} onChange={e => setArea(e.target.value)} aria-label="Área">
              {AREAS.map(a => <option key={a}>{a}</option>)}
            </select>
          )}
          {vista === 'individual' && r && (
            <select className="input" value={clave} onChange={e => setClave(e.target.value)} aria-label="Persona">
              {AREAS.concat([null]).map(a => {
                const lista = r.personas.filter(g => (g.area || null) === a || (a === null && !AREAS.includes(g.area)))
                return lista.length ? <optgroup key={a || 'otros'} label={a || 'Dirección / otros'}>{lista.map(g => <option key={g.clave} value={g.clave}>{g.nombre}</option>)}</optgroup> : null
              })}
            </select>
          )}
        </div>
      </div>

      {error && <div className="card dsp-error">No se pudo cargar el reporte: {error}</div>}
      {!r ? <div className="spinner" /> : (
        vista === 'area' ? <VistaArea r={r} area={area} onAbrir={onAbrir} onPersona={onPersona} />
          : vista === 'individual' ? <VistaIndividual r={r} clave={clave} onAbrir={onAbrir} />
            : <VistaGeneral r={r} onAbrir={onAbrir} onPersona={onPersona} />
      )}
      <p className="dsp-nota">
        Cobrado = estimaciones Enviadas por el mes de su periodo · Proyectado = módulo de Proyecciones · Horas = histórico de Toggl + registros de Track ·
        Utilización = horas ÷ (días hábiles lun–vie × 8 h) · Eficiencia = (avance × horas del contrato) ÷ horas reales. Los montos en USD se muestran aparte; los % y $/h usan MXN.
      </p>
    </div>
  )
}
