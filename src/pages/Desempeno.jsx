import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtMoney } from '../utils/format'
import { puedeVerDesempeno, cargarDesempeno, calcularDesempeno, AREAS } from '../lib/desempeno'
import { COLOR_AREA, textoMes, textoMesCorto, mesIso, nombreCorto } from '../lib/proyecciones'
import { num } from '../lib/track'
import { DatosDesempeno, RecargaDesempeno, ProyectoDetalle, DesgloseConceptos } from '../components/DesempenoProyecto'

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

/** Cuadro flotante al pasar el mouse por una columna de las gráficas */
function Flotante({ x, W, titulo, lineas }) {
  if (!titulo) return null
  const izq = x / W * 100
  return (
    <div className="dsp-flot" style={izq > 60 ? { right: `${100 - izq}%` } : { left: `${izq}%` }} role="tooltip">
      <b>{titulo}</b>
      {lineas.length ? <ul>{lineas.map((l, k) => <li key={k}><span>{l[0]}</span><em>{l[1]}</em></li>)}</ul> : <div className="sub">Sin detalle</div>}
    </div>
  )
}

/** Proyectado vs cobrado (MXN) por mes; al pasar el mouse dice qué proyectos lo forman */
function GraficaCobro({ tendencia, moneda = 'MXN', detalle }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...tendencia.map(t => Math.max(t.cobrado[moneda] || 0, t.proyectado[moneda] || 0)))
  const W = 720, Hh = 180, pad = 26, ancho = (W - pad) / tendencia.length
  const t = hover != null ? tendencia[hover] : null
  return (
    <div className="dsp-graf" onMouseLeave={() => setHover(null)}>
      <svg className="dsp-grafica" viewBox={`0 0 ${W} ${Hh + 22}`} role="img" aria-label={`Proyectado contra cobrado por mes en ${moneda}`}>
        {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={pad} x2={W} y1={Hh - f * Hh + 4} y2={Hh - f * Hh + 4} className="dsp-guia" />)}
        {tendencia.map((t, i) => {
          const x = pad + i * ancho, bw = Math.min(16, ancho / 3)
          const hp = (t.proyectado[moneda] || 0) / max * Hh, hc = (t.cobrado[moneda] || 0) / max * Hh
          return (
            <g key={t.mes} className={hover === i ? 'hover' : ''}>
              <rect x={x + ancho / 2 - bw - 1} y={Hh - hp + 4} width={bw} height={hp} rx="2" className="dsp-b-proy" />
              <rect x={x + ancho / 2 + 1} y={Hh - hc + 4} width={bw} height={hc} rx="2" className="dsp-b-cob" />
              <text x={x + ancho / 2} y={Hh + 18} textAnchor="middle" className="dsp-eje">{textoMesCorto(t.mes)}</text>
              <rect x={x} y={0} width={ancho} height={Hh + 22} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}
        <text x={pad - 4} y={12} textAnchor="end" className="dsp-eje">{num(max / 1000)}k</text>
      </svg>
      {t && <Flotante x={pad + hover * ancho + ancho / 2} W={W} titulo={`${textoMes(t.mes)} · proyectado ${dinero(t.proyectado[moneda], moneda)} · cobrado ${dinero(t.cobrado[moneda], moneda)}`} lineas={detalle ? detalle(t.mes) : []} />}
    </div>
  )
}

/** Horas por mes: directas + indirectas apiladas; al pasar el mouse dice en qué se fueron */
function GraficaHoras({ tendencia, detalle }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...tendencia.map(t => t.horas))
  const W = 720, Hh = 120, pad = 26, ancho = (W - pad) / tendencia.length
  const t = hover != null ? tendencia[hover] : null
  return (
    <div className="dsp-graf" onMouseLeave={() => setHover(null)}>
      <svg className="dsp-grafica" viewBox={`0 0 ${W} ${Hh + 22}`} role="img" aria-label="Horas registradas por mes">
        {tendencia.map((t, i) => {
          const x = pad + i * ancho, bw = Math.min(26, ancho * 0.6)
          const hd = (t.horas - t.indirectas) / max * Hh, hi = t.indirectas / max * Hh
          return (
            <g key={t.mes} className={hover === i ? 'hover' : ''}>
              <rect x={x + (ancho - bw) / 2} y={Hh - hd - hi + 4} width={bw} height={hi} className="dsp-b-ind" />
              <rect x={x + (ancho - bw) / 2} y={Hh - hd + 4} width={bw} height={hd} className="dsp-b-dir" />
              <text x={x + ancho / 2} y={Hh + 18} textAnchor="middle" className="dsp-eje">{textoMesCorto(t.mes)}</text>
              <rect x={x} y={0} width={ancho} height={Hh + 22} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}
        <text x={pad - 4} y={12} textAnchor="end" className="dsp-eje">{num(max)}</text>
      </svg>
      {t && <Flotante x={pad + hover * ancho + ancho / 2} W={W} titulo={`${textoMes(t.mes)} · ${hrs(t.horas, 1)} (${hrs(t.indirectas, 1)} indirectas)`} lineas={detalle ? detalle(t.mes) : []} />}
    </div>
  )
}

/** En qué proyectos se fueron las horas de un grupo de personas en un mes (para el cuadro flotante) */
function useDetalleHoras(personas) {
  const datos = useContext(DatosDesempeno)
  const nombres = useMemo(() => new Map((datos?.tps || []).map(t => [String(t.id), t.nombre])), [datos])
  return mes => {
    const suma = {}
    for (const g of personas) for (const [id, h] of Object.entries(g.meses[mes]?.porProyecto || {})) suma[id] = (suma[id] || 0) + h
    const filas = Object.entries(suma).sort((a, b) => b[1] - a[1])
    const top = filas.slice(0, 8).map(([id, h]) => [nombres.get(String(id)) || 'Proyecto', hrs(h, 1)])
    const resto = filas.slice(8).reduce((a, f) => a + f[1], 0)
    return resto > 0.05 ? [...top, [`${filas.length - 8} proyectos más`, hrs(resto, 1)]] : top
  }
}

/** Qué proyectos forman lo cobrado y lo proyectado de un mes */
function detalleCobro(proyectos, area) {
  return mes => {
    const filas = proyectos.map(x => {
      const cob = area ? x.cobradoMeses[mes]?.[area] || 0 : Object.values(x.cobradoMeses[mes] || {}).reduce((a, b) => a + b, 0)
      const pro = area ? x.proyectadoMeses[mes]?.[area] || 0 : Object.values(x.proyectadoMeses[mes] || {}).reduce((a, b) => a + b, 0)
      return { x, cob, pro }
    }).filter(f => f.cob > 0.5 || f.pro > 0.5).sort((a, b) => b.cob - a.cob || b.pro - a.pro)
    return filas.slice(0, 8).map(f => [f.x.p.name.split(/[_ ]/)[0].slice(0, 28) + ' ' + (f.x.p.name.split('_').slice(1).join(' ').slice(0, 22)), `${f.cob > 0.5 ? dinero(f.cob, f.x.moneda) : '$0'} / ${dinero(f.pro, f.x.moneda)}`])
  }
}

function Leyenda({ items }) {
  return <div className="dsp-leyenda">{items.map(([c, t]) => <span key={t}><i className={c} />{t}</span>)}</div>
}

function TablaProyectos({ filas, area, onAbrir }) {
  const [abierto, setAbierto] = useState(null)
  if (!filas.length) return <p className="dsp-vacio">Sin proyectos activos.</p>
  return (
    <div className="dsp-tabla-wrap">
      <table className="dsp-tabla">
        <thead><tr>
          <th>Proyecto</th><th>{area ? 'Responsable' : 'Líder'}</th><th className="n">Avance</th><th className="n">Proyectado mes</th><th className="n">Cobrado mes</th>
          <th className="n">Horas reales / est.</th><th className="n" title="(avance × horas estimadas) ÷ horas reales; arriba de 100% va mejor que lo planeado">Eficiencia</th>
          <th className="n" title="Lo cobrado acumulado ÷ horas reales">$/h</th><th title="Fecha de fin del proyecto; si no tiene, el último mes con proyección">Mes de cierre</th>
        </tr></thead>
        <tbody>
          {filas.map(x => {
            const avance = area ? x.areaAvance?.[area]?.pct ?? null : x.avance
            const proy = area ? x.proyectadoMes[area] || 0 : x.proyectadoMesTotal
            const cob = area ? x.cobradoMes[area] || 0 : x.cobradoMesTotal
            const ef = x.eficiencia === null ? null : x.eficiencia * 100
            return (
              <Fragment key={x.p.id}>
              <tr className={`dsp-fila${abierto === x.p.id ? ' abierta' : ''}`} onClick={() => setAbierto(abierto === x.p.id ? null : x.p.id)} title="Ver desglose por concepto e indicadores">
                <td><span className="dsp-chev">{abierto === x.p.id ? '▾' : '▸'}</span><a className="dsp-link">{x.p.name}</a>{!x.ligado && <span className="dsp-tag" title="Sin proyecto ligado en Track">sin horas</span>}</td>
                <td className="sub">{area ? (x.responsablesArea?.[area] || []).map(r => r.nombre).join(', ') || '—' : x.lider || '—'}</td>
                <td className="n"><Barra valor={avance} /> {pct(avance)}</td>
                <td className="n">{proy ? dinero(proy, x.moneda) : '—'}</td>
                <td className={`n ${proy > 0 ? semaforo(cob / proy * 100, 95, 60) : ''}`}>{cob ? dinero(cob, x.moneda) : '—'}</td>
                <td className="n">{x.horasReales ? hrs(x.horasReales) : '—'}{x.horasEstimadas ? <span className="sub"> / {hrs(x.horasEstimadas)}</span> : null}</td>
                <td className={`n ${semaforo(ef, 100, 80)}`}>{pct(ef)}</td>
                <td className="n">{x.porHora ? dinero(x.porHora, x.moneda) : '—'}</td>
                <td className="cierre">{x.cierre ? textoMes(x.cierre) : x.termino ? <>{textoMes(x.termino)} <span className="dsp-tag" title="Último mes con proyección">proy.</span></> : <span className="sub">{x.porEstimar > 0.5 ? 'Sin proyección' : 'Cobrado'}</span>}</td>
              </tr>
              {abierto === x.p.id && <tr className="dsp-fila-detalle"><td colSpan={9}><ProyectoDetalle projectId={x.p.id} onAbrir={onAbrir} onCerrar={() => setAbierto(null)} /></td></tr>}
              </Fragment>
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

function TablaPersonas({ personas, onElegir, cobradoDe }) {
  return (
    <div className="dsp-tabla-wrap">
      <table className="dsp-tabla">
        <thead><tr><th>Persona</th><th>Área</th><th className="n">Horas</th><th className="n">Directas</th><th className="n">Indirectas</th><th className="n" title="Horas registradas ÷ (días hábiles × 8 h)">Utilización</th><th className="n">Sin concepto</th>{cobradoDe && <th className="n" title="Lo cobrado este mes en el área de los proyectos donde es responsable">Cobrado del mes</th>}</tr></thead>
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
              {cobradoDe && (() => { const c = cobradoDe(g); return <td className="n fuerte" title={c.detalle}>{c.total > 0.5 ? dinero(c.total) : '—'}</td> })()}
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
  const detHorasGeneral = useDetalleHoras(r.personas)
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
          <GraficaCobro tendencia={r.tendencia} detalle={detalleCobro(r.proyectos)} />
          <Leyenda items={[['dsp-b-proy', 'Proyectado'], ['dsp-b-cob', 'Cobrado']]} />
        </Seccion>
        <Seccion titulo="Horas del equipo" sub="Toggl + Track">
          <GraficaHoras tendencia={r.tendencia} detalle={detHorasGeneral} />
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
  const detHoras = useDetalleHoras(a?.personas || [])
  if (!a) return null
  // Cobrado del mes por persona: lo del área en los proyectos donde es responsable
  const cobradoDe = g => {
    const mios = a.proyectos.filter(x => (x.responsablesArea?.[area] || []).some(r => r.email === String(g.email || '').toLowerCase()))
    const total = mios.reduce((s, x) => s + (x.moneda === 'MXN' ? x.cobradoMes[area] || 0 : 0), 0)
    const detalle = mios.filter(x => x.cobradoMes[area] > 0.5).map(x => `${x.p.name}: ${dinero(x.cobradoMes[area], x.moneda)}`).join('\n') || `Responsable de ${mios.length} proyectos del área`
    return { total, detalle }
  }
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
        <Seccion titulo="Proyectado vs cobrado" sub={`${area} · MXN`}><GraficaCobro tendencia={tendencia} detalle={detalleCobro(r.proyectos, area)} /><Leyenda items={[['dsp-b-proy', 'Proyectado'], ['dsp-b-cob', 'Cobrado']]} /></Seccion>
        <Seccion titulo="Horas del área"><GraficaHoras tendencia={tendencia} detalle={detHoras} /><Leyenda items={[['dsp-b-dir', 'Directas'], ['dsp-b-ind', 'Indirectas']]} /></Seccion>
      </div>
      <Seccion titulo="Personas del área" sub={textoMes(r.mes)}><TablaPersonas personas={a.personas} onElegir={onPersona} cobradoDe={cobradoDe} /></Seccion>
      <Seccion titulo="Proyectos" sub="montos y avance solo de esta área"><TablaProyectos filas={a.proyectos} area={area} onAbrir={onAbrir} /></Seccion>
      <Seccion titulo="Atrasos del área"><TablaAtrasos atrasos={a.atrasos} onAbrir={onAbrir} /></Seccion>
    </>
  )
}


/** Horas de la persona contra el dinero de cada proyecto, lado a lado; el desglose se abre debajo de la fila. */
function RepartoHorasLana({ r, g, tpSel, setTpSel, onAbrir }) {
  const [periodo, setPeriodo] = useState('mes')
  const [todos, setTodos] = useState(false)
  const meses = periodo === 'mes' ? [r.mes] : r.meses
  const porTp = {}
  for (const m of meses) for (const [id, h] of Object.entries(g.meses[m]?.porProyecto || {})) porTp[id] = (porTp[id] || 0) + h
  const proyPorId = new Map(r.todos.map(x => [x.p.id, x]))
  const datos = useContext(DatosDesempeno)
  const tpPorId = new Map((datos?.tps || []).map(t => [String(t.id), t]))
  const filas = Object.entries(porTp).map(([id, h]) => {
    const tp = tpPorId.get(String(id))
    const x = tp?.project_id ? proyPorId.get(tp.project_id) : null
    const cobrado = x ? meses.reduce((a, m) => a + (x.cobradoPorMes[m] || 0), 0) : null
    const horasEquipo = x ? meses.reduce((a, m) => a + (x.horasPorMes[m] || 0), 0) : null
    // $/h del proyecto con todo lo cobrado ÷ todas sus horas: lo cobrado antes de la migración entró como saldo al corte
    // (no por mes), así que un $/h de solo el periodo saldría engañoso
    const porHora = x?.porHora > 0 ? x.porHora : null
    return { id, tp, x, h, cobrado, horasEquipo, porHora, suParte: porHora != null ? porHora * h : null, moneda: x?.moneda || 'MXN' }
  }).filter(f => f.h > 0.05).sort((a, b) => b.h - a.h)
  if (!filas.length) return <p className="dsp-vacio">Sin horas registradas en el periodo.</p>
  const maxH = filas[0].h, maxL = Math.max(1, ...filas.map(f => f.cobrado || 0))
  const totH = filas.reduce((a, f) => a + f.h, 0)
  const totParte = filas.reduce((a, f) => a + (f.moneda === 'MXN' ? f.suParte || 0 : 0), 0)
  const enIndirectos = filas.filter(f => !f.x).reduce((a, f) => a + f.h, 0)
  const visibles = todos ? filas : filas.slice(0, 10)
  return (
    <>
      <div className="dsp-chips">
        {[['mes', textoMes(r.mes)], ['12m', 'Últimos 12 meses']].map(([k, t]) => <button key={k} className={periodo === k ? 'activa' : ''} onClick={() => setPeriodo(k)}>{t}</button>)}
        <span className="dsp-resumen-hl"><b>{hrs(totH, 1)}</b> en {filas.length} proyectos · <b>{dinero(totParte)}</b> de valor generado · {hrs(enIndirectos, 1)} en internos</span>
      </div>
      <div className="dsp-hl">
        <div className="dsp-hl-cab"><span>Proyecto</span><span>Sus horas</span><span>Cobrado en el periodo</span><span title="Todo lo cobrado del proyecto ÷ todas sus horas (Toggl + Track)">$/h proyecto</span><span title="$/h del proyecto × sus horas del periodo">Su parte</span></div>
        {visibles.map(f => (
          <Fragment key={f.id}>
            <div className={`dsp-hl-fila${tpSel === f.tp?.id ? ' abierta' : ''}`} onClick={() => f.tp && setTpSel(tpSel === f.tp.id ? null : f.tp.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && f.tp && setTpSel(tpSel === f.tp.id ? null : f.tp.id)}>
              <span className="nombre"><span className="dsp-chev">{tpSel === f.tp?.id ? '▾' : '▸'}</span>{f.tp?.nombre || 'Proyecto'}</span>
              <span className="barra-h"><i style={{ width: `${f.h / maxH * 100}%` }} /><em>{hrs(f.h, 1)}</em></span>
              <span className="barra-l">{f.x ? <><i style={{ width: `${(f.cobrado || 0) / maxL * 100}%` }} /><em>{f.cobrado > 0.5 ? dinero(f.cobrado, f.moneda) : '$0'}</em></> : <em className="sub">{esInterno(f.tp) ? 'interno' : 'sin ligar'}</em>}</span>
              <span className="n">{f.porHora != null ? dinero(f.porHora, f.moneda) : '—'}</span>
              <span className="n fuerte">{f.suParte != null ? dinero(f.suParte, f.moneda) : '—'}</span>
            </div>
            {tpSel === f.tp?.id && <div className="dsp-hl-detalle"><DesgloseConceptos key={tpSel} tpId={tpSel} email={g.email} meses={meses} onAbrir={onAbrir} onCerrar={() => setTpSel(null)} /></div>}
          </Fragment>
        ))}
      </div>
      {filas.length > 10 && <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setTodos(!todos)}>{todos ? 'Ver menos' : `Ver los ${filas.length}`}</button>}
      <p className="dsp-nota">Su parte = $/h del proyecto (todo lo cobrado ÷ todas sus horas) × sus horas del periodo. "Cobrado en el periodo" solo cuenta estimaciones capturadas por mes: lo cobrado antes de la migración entró como saldo al corte{periodo === 'mes' && r.mes === mesIso(new Date()) ? ', y el mes en curso se cobra al cierre' : ''}.</p>
    </>
  )
}
const esInterno = tp => /^0\d\d/.test(tp?.nombre || '')

function VistaIndividual({ r, clave, onAbrir }) {
  const [tpSel, setTpSel] = useState(null)
  useEffect(() => { setTpSel(null) }, [clave])
  const g = r.personas.find(x => x.clave === clave)
  const detHoras = useDetalleHoras(g ? [g] : [])
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
      <Seccion titulo="Horas por mes" sub="últimos 12 meses · pasa el mouse para ver en qué"><GraficaHoras tendencia={tendencia} detalle={detHoras} /><Leyenda items={[['dsp-b-dir', 'Directas'], ['dsp-b-ind', 'Indirectas']]} /></Seccion>
      <Seccion titulo="Dónde se fueron las horas" sub="sus horas contra lo que cobra cada proyecto · pícale a uno para ver actividad por actividad">
        <RepartoHorasLana r={r} g={g} tpSel={tpSel} setTpSel={setTpSel} onAbrir={onAbrir} />
      </Seccion>
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
      <RecargaDesempeno.Provider value={cargar}>
      <DatosDesempeno.Provider value={datos}>
      {!r ? <div className="spinner" /> : (
        vista === 'area' ? <VistaArea r={r} area={area} onAbrir={onAbrir} onPersona={onPersona} />
          : vista === 'individual' ? <VistaIndividual r={r} clave={clave} onAbrir={onAbrir} />
            : <VistaGeneral r={r} onAbrir={onAbrir} onPersona={onPersona} />
      )}
      </DatosDesempeno.Provider>
      </RecargaDesempeno.Provider>
      <p className="dsp-nota">
        Cobrado = estimaciones Enviadas por el mes de su periodo · Proyectado = módulo de Proyecciones · Horas = histórico de Toggl + registros de Track ·
        Utilización = horas ÷ (días hábiles lun–vie × 8 h) · Eficiencia = (avance × horas del contrato) ÷ horas reales. Los montos en USD se muestran aparte; los % y $/h usan MXN.
      </p>
    </div>
  )
}
