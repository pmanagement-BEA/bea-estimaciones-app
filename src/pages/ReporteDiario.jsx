import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { puedeVerReporteDiario, prepararCalendario, diaHabilAnterior, cargarDia, calcularDia } from '../lib/reporteDiario'
import { textoHoras, textoDiaLargo, sumarDias, hhmm, diaIso, nombreDia } from '../lib/checador'
import { nombreCorto } from '../lib/proyecciones'

const COLOR = { 'Consultoría': '#0B3D24', 'Commissioning': '#4A1320', 'Modelación': '#0E1F3D', 'Dirección / PMO': '#3A3E45', 'Sin área': '#7B8794' }
const h = ms => textoHoras(ms || 0)
const pct = (a, b) => (b > 0 ? `${Math.round(a / b * 100)}%` : '—')
const ESTADO = {
  completo: ['Completo', 'ok'], falta: ['Le faltó', 'medio'], nada: ['Sin registro', 'mal'],
  ausencia: ['Ausencia', 'gris'], 'no-laboral': ['No le tocaba', 'gris'],
}

function Barra({ valor, max, color }) {
  const w = Math.max(0, Math.min(100, max > 0 ? valor / max * 100 : 0))
  return <span className="rd-barra"><i style={{ width: `${w}%`, background: color || '#0B3D24' }} /></span>
}

function ListaProyectos({ proyectos, max }) {
  if (!proyectos.length) return <p className="rd-vacio">Nadie registró horas este día.</p>
  return (
    <ul className="rd-proy">
      {proyectos.map(p => (
        <li key={p.proyecto} title={p.personas.join(', ')}>
          <span className="nombre">{p.proyecto}{p.indirecto && <span className="rd-tag">interno</span>}</span>
          <Barra valor={p.ms} max={max} color={p.indirecto ? '#8a97a8' : '#0B3D24'} />
          <span className="n">{h(p.ms)}</span>
          <span className="sub">{p.personas.length} {p.personas.length === 1 ? 'persona' : 'personas'}</span>
        </li>
      ))}
    </ul>
  )
}

function TablaPersonas({ personas }) {
  const [abierta, setAbierta] = useState(null)
  return (
    <div className="rd-tabla-wrap">
      <table className="rd-tabla">
        <thead><tr><th>Persona</th><th>Área</th><th className="n">Registró</th><th className="n">Le tocaba</th><th className="n">Checó</th><th>Estado</th></tr></thead>
        <tbody>
          {personas.map(p => {
            const [txt, tono] = ESTADO[p.estado]
            const raro = p.checado > p.track + 0.5 * 3600000 && p.esperadas > 0
            return (
              <Fragment key={p.email}>
                <tr className={`rd-fila${abierta === p.email ? ' abierta' : ''}`} onClick={() => setAbierta(abierta === p.email ? null : p.email)}>
                  <td><span className="rd-chev">{abierta === p.email ? '▾' : '▸'}</span>{nombreCorto(p.nombre)}</td>
                  <td className="sub">{p.area}</td>
                  <td className="n fuerte">{h(p.track)}</td>
                  <td className="n">{p.esperadas ? h(p.esperadas) : '—'}</td>
                  <td className={`n ${raro ? 'medio' : ''}`} title={raro ? 'Checó más de lo que registró en Track' : ''}>{p.checado ? h(p.checado) : '—'}</td>
                  <td><span className={`rd-estado ${tono}`}>{p.estado === 'falta' ? `Le faltó ${h(p.falta)}` : p.estado === 'ausencia' ? p.ausencia : txt}</span></td>
                </tr>
                {abierta === p.email && (
                  <tr className="rd-detalle"><td colSpan={6}>
                    {p.registros.length ? (
                      <ul className="rd-regs">
                        {p.registros.map(r => (
                          <li key={r.id}>
                            <span className="hora">{hhmm(r.inicio)}–{r.fin ? hhmm(r.fin) : 'corriendo'}</span>
                            <span className="que"><b>{r.proyecto}</b>{r.que && <> · {r.que}</>}{r.descripcion && <span className="sub"> — {r.descripcion}</span>}</span>
                            {!r.conConcepto && !r.indirecto && <span className="rd-tag aviso">sin concepto</span>}
                            <span className="n">{h(r.ms)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="rd-vacio">No registró nada en Track este día.</p>}
                  </td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ReporteDiario() {
  const [permiso, setPermiso] = useState(null)
  const [listo, setListo] = useState(false)
  const [fecha, setFecha] = useState(null)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState('empresa')
  const [area, setArea] = useState(null)

  useEffect(() => { puedeVerReporteDiario().then(setPermiso) }, [])
  useEffect(() => {
    if (!permiso) return
    prepararCalendario().then(() => { setFecha(diaHabilAnterior()); setListo(true) })
  }, [permiso])
  const cargar = useCallback(async () => {
    if (!fecha) return
    setError(''); setDatos(null)
    try { setDatos(await cargarDia(fecha)) } catch (e) { setError(e.message || String(e)) }
  }, [fecha])
  useEffect(() => { if (listo) cargar() }, [listo, cargar])
  const r = useMemo(() => (datos ? calcularDia(datos) : null), [datos])

  if (permiso === null) return <div className="main"><div className="spinner" /></div>
  if (!permiso) return <div className="main"><div className="empty-state"><h3>Reporte diario</h3><p>Solo lo ven PMO, Dirección y quien tenga el permiso en el Directorio.</p></div></div>

  const t = r?.totales
  const areaSel = r && (r.areas.find(a => a.area === area) || r.areas[0])
  return (
    <div className="main rd">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte <span className="accent">diario</span></h1>
          <div className="page-subtitle">{fecha ? textoDiaLargo(fecha) : ''}{fecha && nombreDia(fecha) ? ` · ${nombreDia(fecha)}` : ''}</div>
        </div>
        <div className="flex rd-fecha" style={{ gap: 6, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior">‹</button>
          <input type="date" className="input" value={fecha || ''} max={diaIso()} onChange={e => e.target.value && setFecha(e.target.value)} aria-label="Día del reporte" />
          <button className="btn btn-outline btn-sm" onClick={() => setFecha(sumarDias(fecha, 1))} disabled={!fecha || fecha >= diaIso()} aria-label="Día siguiente">›</button>
          <button className="btn btn-outline btn-sm" onClick={cargar}>Actualizar</button>
        </div>
      </div>

      {error && <div className="card" style={{ color: '#C53030' }}>No se pudo cargar: {error}</div>}
      {!r ? <div className="spinner" /> : (
        <>
          {!r.laborable && <p className="rd-aviso">Día no hábil: a nadie le tocaba registrar horas.</p>}
          <div className="summary-grid rd-kpis">
            <div className="stat-box"><div className="stat-label">Horas registradas</div><div className="stat-value">{h(t.track)}</div><div className="stat-sub">{pct(t.track, t.esperadas)} de {h(t.esperadas)} que tocaban</div></div>
            <div className="stat-box"><div className="stat-label">Registraron</div><div className="stat-value">{t.registraron} <small>de {t.esperaban}</small></div><div className="stat-sub">{t.ausentes} con ausencia aprobada</div></div>
            <div className={`stat-box ${r.conFalta.length ? 'rd-alerta' : ''}`}><div className="stat-label">Registraron menos</div><div className="stat-value">{r.conFalta.length}</div><div className="stat-sub">personas con horas faltantes</div></div>
            <div className="stat-box"><div className="stat-label">Checado vs registrado</div><div className="stat-value">{h(t.checado)}</div><div className="stat-sub">en el Checador · {pct(t.indirectas, t.track)} de lo registrado fue interno</div></div>
          </div>

          {r.conFalta.length > 0 && (
            <section className="card rd-sec">
              <h3>Registraron menos de lo que les tocaba</h3>
              <ul className="rd-falta">
                {r.conFalta.map(p => (
                  <li key={p.email}>
                    <span className="nombre">{nombreCorto(p.nombre)}</span>
                    <span className="sub">{p.area}</span>
                    <Barra valor={p.track} max={p.esperadas} color={COLOR[p.area]} />
                    <span className="n">{h(p.track)} <span className="sub">de {h(p.esperadas)}</span></span>
                    <span className="rd-estado mal">{p.track ? `Faltan ${h(p.falta)}` : 'Sin registro'}</span>
                    {p.checado > 0 && <span className="sub" title="Horas en el Checador ese día">checó {h(p.checado)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="tabs rd-tabs">
            {[['empresa', 'Empresa'], ['area', 'Por área'], ['individual', 'Individual']].map(([k, txt]) => <div key={k} className={`tab${vista === k ? ' active' : ''}`} onClick={() => setVista(k)} role="tab" aria-selected={vista === k}>{txt}</div>)}
          </div>

          {vista === 'empresa' && (
            <section className="card rd-sec">
              <h3>Dónde se fueron las horas</h3>
              <ListaProyectos proyectos={r.proyectos} max={r.proyectos[0]?.ms || 1} />
            </section>
          )}

          {vista === 'area' && areaSel && (
            <>
              <div className="rd-areas">
                {r.areas.map(a => (
                  <button key={a.area} className={`rd-area${areaSel.area === a.area ? ' sel' : ''}`} style={{ background: COLOR[a.area] }} onClick={() => setArea(a.area)} aria-pressed={areaSel.area === a.area}>
                    <span className="nom">{a.area}</span>
                    <span className="num">{h(a.track)}</span>
                    <span className="sub2">{pct(a.track, a.esperadas)} de lo que tocaba · {a.conFalta} con faltante</span>
                  </button>
                ))}
              </div>
              <section className="card rd-sec">
                <h3>{areaSel.area}: dónde se fueron las horas</h3>
                <ListaProyectos proyectos={areaSel.proyectos} max={areaSel.proyectos[0]?.ms || 1} />
              </section>
              <section className="card rd-sec"><h3>Personas de {areaSel.area}</h3><TablaPersonas personas={areaSel.personas} /></section>
            </>
          )}

          {vista === 'individual' && (
            <section className="card rd-sec"><h3>Todas las personas</h3><TablaPersonas personas={[...r.personas].sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre))} /></section>
          )}
          <p className="rd-nota">Le tocaba = 8 h en día hábil; 0 en fin de semana, festivo o con ausencia aprobada. Solo cuenta lo registrado en Track (lo de Toggl no llega por día).</p>
        </>
      )}
    </div>
  )
}
