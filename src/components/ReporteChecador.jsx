// Reporte del Checador (dentro de Reporte diario): asistencia, faltas, retardos y salidas tempranas.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { rangoPeriodo, cargarPeriodo, calcularPeriodo, minDelDia, TOLERANCIA_MIN } from '../lib/reporteChecador'
import { textoHoras, textoDia, hhmm, HORARIO } from '../lib/checador'
import { nombreCorto } from '../lib/proyecciones'
import { diaHabilAnterior } from '../lib/reporteDiario'
import BarraFecha from './BarraFecha'

const COLOR = { 'Consultoría': '#0B3D24', 'Commissioning': '#4A1320', 'Modelación': '#0E1F3D', 'Dirección / PMO': '#3A3E45', 'Sin área': '#7B8794' }
const h = ms => textoHoras(ms || 0)
const dif = ms => textoHoras(ms || 0, true)
const pct = (a, b) => (b > 0 ? `${Math.round(a / b * 100)}%` : '—')
const LIM = (() => { const [hh, mm] = HORARIO.inicio.split(':').map(Number); return hh * 60 + mm + TOLERANCIA_MIN })()

function Marcas({ p }) {
  return (
    <span className="rc-marcas">
      {p.faltas.length > 0 && <span className="rd-estado mal">{p.faltas.length} {p.faltas.length === 1 ? 'falta' : 'faltas'}</span>}
      {p.retardos.length > 0 && <span className="rd-estado medio">{p.retardos.length} {p.retardos.length === 1 ? 'retardo' : 'retardos'}</span>}
      {p.tempranas.length > 0 && <span className="rd-estado medio">{p.tempranas.length} salida{p.tempranas.length === 1 ? '' : 's'} antes</span>}
      {p.sinSalida > 0 && <span className="rd-estado medio">{p.sinSalida} sin salida</span>}
      {p.editados > 0 && <span className="rd-estado">{p.editados} editado{p.editados === 1 ? '' : 's'}</span>}
      {p.ausencias.length > 0 && <span className="rd-estado gris">{p.motivosAusencia.join(', ')}</span>}
    </span>
  )
}

function DiasPersona({ dias }) {
  const lista = dias.filter(d => d.esperadas > 0 || d.ms > 0 || d.ausencia)
  if (!lista.length) return <p className="rd-vacio">Sin días hábiles en el periodo.</p>
  return (
    <ul className="rc-dias">
      {lista.map(d => {
        const tarde = d.entrada && d.esperadas > 0 && minDelDia(d.entrada) > LIM
        return (
          <li key={d.fecha}>
            <span className="f">{textoDia(d.fecha)}</span>
            <span className={tarde ? 'tarde' : ''}>{d.entrada ? hhmm(d.entrada) : '—'}</span>
            <span>{d.salida === 'ahora' ? 'dentro' : d.salida ? hhmm(d.salida) : d.entrada ? 'sin salida' : '—'}</span>
            <span className="n">{h(d.ms)}</span>
            <span className={`n ${d.diferencia < 0 ? 'neg' : ''}`}>{d.ausencia ? 'ausencia' : d.esperadas ? dif(d.diferencia) : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}

function TablaPersonas({ personas, dia }) {
  const [abierta, setAbierta] = useState(null)
  return (
    <div className="rd-tabla-wrap">
      <table className="rd-tabla">
        <thead><tr>
          <th>Persona</th><th>Área</th>
          {dia ? <><th>Entrada</th><th>Salida</th></> : <th className="n">Asistencia</th>}
          <th className="n">Horas</th><th className="n">Contra lo esperado</th><th>Avisos</th>
        </tr></thead>
        <tbody>
          {personas.map(p => {
            const d0 = p.dias[0]
            return (
              <Fragment key={p.email}>
                <tr className={`rd-fila${abierta === p.email ? ' abierta' : ''}`} onClick={() => !dia && setAbierta(abierta === p.email ? null : p.email)}>
                  <td>{!dia && <span className="rd-chev">{abierta === p.email ? '▾' : '▸'}</span>}{nombreCorto(p.nombre)}</td>
                  <td className="sub">{p.area}</td>
                  {dia ? (
                    <>
                      <td className={d0?.entrada && minDelDia(d0.entrada) > LIM ? 'rc-tarde' : ''}>{d0?.entrada ? hhmm(d0.entrada) : '—'}</td>
                      <td>{d0?.salida === 'ahora' ? 'dentro' : d0?.salida ? hhmm(d0.salida) : d0?.entrada ? 'sin salida' : '—'}</td>
                    </>
                  ) : <td className="n">{p.habiles ? `${p.asistio}/${p.habiles}` : '—'}</td>}
                  <td className="n fuerte">{h(p.ms)}</td>
                  <td className={`n ${p.diferencia < 0 ? 'rc-neg' : ''}`}>{p.esperadas ? dif(p.diferencia) : '—'}</td>
                  <td><Marcas p={p} /></td>
                </tr>
                {abierta === p.email && <tr className="rd-detalle"><td colSpan={7}><DiasPersona dias={p.dias} /></td></tr>}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Reporte del Checador (pestaña dentro de Checador; solo quien tiene ve_reporte_diario). El calendario BEA ya lo cargó la página. */
export default function ReporteChecador() {
  const [fecha, setFecha] = useState(() => diaHabilAnterior())
  const [tipo, setTipo] = useState('dia')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState('empresa')
  const [area, setArea] = useState(null)
  const { desde, hasta } = rangoPeriodo(tipo, fecha)
  const cargar = useCallback(async () => {
    setError(''); setDatos(null)
    try { setDatos(await cargarPeriodo(desde, hasta)) } catch (e) { setError(e.message || String(e)) }
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])
  const r = useMemo(() => (datos ? calcularPeriodo(datos) : null), [datos])
  const t = r?.total
  const esDia = tipo === 'dia'
  const areaSel = r && (r.areas.find(a => a.area === area) || r.areas[0])
  const conFaltas = r ? r.personas.filter(p => p.faltas.length).sort((a, b) => b.faltas.length - a.faltas.length) : []
  const conRetardos = r ? r.personas.filter(p => p.retardos.length).sort((a, b) => b.retardos.length - a.retardos.length) : []

  return (
    <div className="rd">
      <BarraFecha fecha={fecha} setFecha={setFecha} onActualizar={cargar} />
      <div className="dsp-chips rc-periodo">
        {[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, txt]) => <button key={k} className={tipo === k ? 'activa' : ''} onClick={() => setTipo(k)}>{txt}</button>)}
        <span className="sub">{desde === hasta ? textoDia(desde) : `${textoDia(desde)} – ${textoDia(hasta)}`} · retardo = entrada después de las {HORARIO.inicio} + {TOLERANCIA_MIN} min · salida esperada {HORARIO.fin}</span>
      </div>
      {error && <div className="card" style={{ color: '#C53030' }}>No se pudo cargar: {error}</div>}
      {!r ? <div className="spinner" /> : (
        <>
          <div className="summary-grid rd-kpis">
            <div className="stat-box"><div className="stat-label">Asistencia</div><div className="stat-value">{pct(t.asistio, t.habiles)}</div><div className="stat-sub">{t.asistio} de {t.habiles} días hábiles · {t.ausencias} con ausencia</div></div>
            <div className={`stat-box ${t.faltas ? 'rd-alerta' : ''}`}><div className="stat-label">Faltas</div><div className="stat-value">{t.faltas}</div><div className="stat-sub">días sin checar y sin ausencia</div></div>
            <div className="stat-box"><div className="stat-label">Retardos</div><div className="stat-value">{t.retardos}</div><div className="stat-sub">{t.tempranas} salidas antes de las {HORARIO.fin}</div></div>
            <div className="stat-box"><div className="stat-label">Horas checadas</div><div className="stat-value">{h(t.ms)}</div><div className="stat-sub">{dif(t.diferencia)} contra lo esperado · {t.sinSalida} sin salida</div></div>
          </div>

          {(conFaltas.length > 0 || conRetardos.length > 0) && (
            <div className="rc-alertas">
              {conFaltas.length > 0 && (
                <section className="card rd-sec"><h3>Faltas</h3>
                  <ul className="rc-lista">{conFaltas.map(p => <li key={p.email}><b>{nombreCorto(p.nombre)}</b><span className="sub">{p.area}</span><span>{p.faltas.map(x => textoDia(x.fecha)).join(', ')}</span></li>)}</ul>
                </section>
              )}
              {conRetardos.length > 0 && (
                <section className="card rd-sec"><h3>Retardos</h3>
                  <ul className="rc-lista">{conRetardos.map(p => <li key={p.email}><b>{nombreCorto(p.nombre)}</b><span className="sub">{p.area}</span><span>{p.retardos.map(x => `${textoDia(x.fecha)} ${hhmm(x.entrada)}`).join(', ')}</span></li>)}</ul>
                </section>
              )}
            </div>
          )}

          <div className="tabs rd-tabs">
            {[['empresa', 'Empresa'], ['area', 'Por área'], ['individual', 'Individual']].map(([k, txt]) => <div key={k} className={`tab${vista === k ? ' active' : ''}`} onClick={() => setVista(k)} role="tab" aria-selected={vista === k}>{txt}</div>)}
          </div>
          {vista === 'empresa' && (
            <div className="rd-areas">
              {r.areas.map(a => (
                <div key={a.area} className="rd-area estatica" style={{ background: COLOR[a.area] }}>
                  <span className="nom">{a.area}</span>
                  <span className="num">{pct(a.asistio, a.habiles)}</span>
                  <span className="sub2">asistencia · {a.faltas} faltas · {a.retardos} retardos · {h(a.ms)}</span>
                </div>
              ))}
            </div>
          )}
          {vista === 'area' && areaSel && (
            <>
              <div className="rd-areas">
                {r.areas.map(a => (
                  <button key={a.area} className={`rd-area${areaSel.area === a.area ? ' sel' : ''}`} style={{ background: COLOR[a.area] }} onClick={() => setArea(a.area)} aria-pressed={areaSel.area === a.area}>
                    <span className="nom">{a.area}</span><span className="num">{pct(a.asistio, a.habiles)}</span><span className="sub2">{a.faltas} faltas · {a.retardos} retardos</span>
                  </button>
                ))}
              </div>
              <section className="card rd-sec"><h3>Personas de {areaSel.area}</h3><TablaPersonas personas={areaSel.personas} dia={esDia} /></section>
            </>
          )}
          {vista === 'individual' && (
            <section className="card rd-sec"><h3>Todas las personas</h3><TablaPersonas personas={[...r.personas].sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre))} dia={esDia} /></section>
          )}
          <p className="rd-nota">Falta = día hábil sin checar y sin ausencia aprobada (el día de hoy no cuenta). Horas y diferencia, como en el Checador: jornada de {HORARIO.horas} h.</p>
        </>
      )}
    </div>
  )
}
