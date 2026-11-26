// Desglose de un proyecto dentro del reporte de desempeño (se abre al picarle a un proyecto).
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fmtMoney } from '../utils/format'
import { detalleProyecto, cargarActividadesHoras } from '../lib/desempenoDetalle'
import { COLOR_AREA, textoMes, nombreCorto } from '../lib/proyecciones'
import { num } from '../lib/track'

export const DatosDesempeno = createContext(null)

const ETQ = { 'Consultoría': 'CV', 'Commissioning': 'CX', 'Modelación': 'ME' }
const dinero = (n, moneda = 'MXN') => (n == null || isNaN(n) ? '—' : fmtMoney(Math.round(n), moneda).replace(/\.00$/, ''))
const hrs = (n, dec = 0) => (n == null || isNaN(n) ? '—' : `${num(n, dec)} h`)
const pct = (x, dec = 0) => (x == null || isNaN(x) ? '—' : `${num(x * 100, dec)}%`)
const veces = x => (x == null || isNaN(x) ? '—' : num(x, 2))
/** Semáforo del RC-OP-43: ≥ 1 bien · 0.8–1 atención · < 0.8 mal */
const tono = x => (x == null || isNaN(x) ? '' : x >= 1 ? 'ok' : x >= 0.8 ? 'medio' : 'mal')
const flecha = x => (x == null || isNaN(x) ? '' : x >= 1 ? '▲' : '▼')

function Barra({ valor, max = 1, color }) {
  const w = Math.max(0, Math.min(100, (valor || 0) / (max || 1) * 100))
  return <span className="dsp-barra"><span style={{ width: `${w}%`, background: color || 'var(--green)' }} /></span>
}

export function ProyectoDetalle({ tpId, projectId, email, onAbrir, onCerrar }) {
  const datos = useContext(DatosDesempeno)
  const d = useMemo(() => (datos ? detalleProyecto(datos, { tpId, projectId, email }) : null), [datos, tpId, projectId, email])
  const [actividades, setActividades] = useState(null)
  const [verCobrados, setVerCobrados] = useState(false)
  const ids = d?.tpIds.join(',')
  useEffect(() => {
    let vivo = true
    setActividades(null)
    if (ids) cargarActividadesHoras(ids.split(',')).then(a => { if (vivo) setActividades(a) })
    else setActividades([])
    return () => { vivo = false }
  }, [ids])
  if (!d) return null

  const visibles = d.conceptos.filter(c => verCobrados || c.estado !== 'Cobrado' || c.horas > 0)
  const ocultos = d.conceptos.length - visibles.length
  const maxAct = actividades?.[0]?.horas_toggl || 1
  const persona = email ? d.personas.find(p => p.email?.toLowerCase() === email.toLowerCase()) : null

  return (
    <div className="dsp-detalle">
      <div className="dsp-detalle-tit">
        <div>
          <b>{d.titulo}</b>
          <span className="sub"> · clave {d.clave || '—'}{d.varios ? ' · los indicadores H-H suman todos los proyectos de la clave (como el RC-OP-43)' : ''}</span>
          {persona && <div className="sub">Horas de {nombreCorto(persona.nombre)}: {hrs(persona.mes, 1)} en {textoMes(datos.mes)} · {hrs(persona.total, 1)} en 12 meses</div>}
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 6 }}>
          {d.proyecto && onAbrir && <button className="btn btn-outline btn-sm" onClick={() => onAbrir(d.proyecto)}>Ver estimaciones</button>}
          {onCerrar && <button className="btn btn-outline btn-sm" onClick={onCerrar} aria-label="Cerrar desglose">✕</button>}
        </div>
      </div>

      {/* Indicadores por área (RC-OP-43) */}
      <h4 className="dsp-sub">Horas-hombre contra avance, por área</h4>
      {!d.tieneRcOp43 && <p className="dsp-vacio">La clave {d.clave || '—'} no tiene presupuesto H-H en el RC-OP-43; se muestran solo los montos.</p>}
      {d.areas.length ? (
        <div className="dsp-tabla-wrap">
          <table className="dsp-tabla">
            <thead><tr>
              <th>Área</th><th className="n">Presupuesto H-H</th><th className="n">H-H acumuladas</th><th className="n">Consumo</th><th className="n">Avance (cobrado)</th>
              <th className="n" title="Avance ÷ consumo de horas. ≥ 1 bien · 0.8–1 atención · < 0.8 se pasan de horas">Desviación</th>
              <th className="n" title="Lo contratado del área ÷ H-H presupuestadas">$/h plan</th>
              <th className="n" title="Lo cobrado del área ÷ H-H acumuladas">$/h real</th>
              <th className="n">H-H restantes</th>
              <th className="n" title="Lo que falta por cobrar ÷ H-H restantes: a cuánto tiene que salir cada hora de aquí al final">$/h para cerrar</th>
              <th className="n" title="H-H acumuladas ÷ avance: cuántas horas va a costar el área completa a este ritmo">H-H al terminar</th>
            </tr></thead>
            <tbody>
              {d.areas.map(a => {
                const relHora = a.hhReal != null && a.hhPresupuesto ? a.hhReal / a.hhPresupuesto : null
                const relFinal = a.alTerminar != null && a.presupuestoHH ? a.presupuestoHH / a.alTerminar : null
                return (
                  <tr key={a.area}>
                    <td><i className="dsp-punto" style={{ background: COLOR_AREA[a.area] }} />{ETQ[a.area]} · {a.area}</td>
                    <td className="n">{hrs(a.presupuestoHH)}</td>
                    <td className="n">{hrs(a.hh)}</td>
                    <td className="n"><Barra valor={a.consumo} max={1} color={a.consumo > 1 ? '#d64545' : undefined} /> {pct(a.consumo)}</td>
                    <td className="n"><Barra valor={a.avance} max={1} color={COLOR_AREA[a.area]} /> {pct(a.avance)}</td>
                    <td className={`n ${tono(a.desviacion)}`}>{veces(a.desviacion)} {flecha(a.desviacion)}</td>
                    <td className="n">{dinero(a.hhPresupuesto, d.moneda)}</td>
                    <td className={`n ${tono(relHora)}`}>{dinero(a.hhReal, d.moneda)} {flecha(relHora)}</td>
                    <td className={`n ${a.restantes != null && a.restantes < 0 ? 'mal' : ''}`}>{hrs(a.restantes)}</td>
                    <td className="n">{dinero(a.hhNecesario, d.moneda)}</td>
                    <td className={`n ${tono(relFinal)}`}>{hrs(a.alTerminar)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="dsp-vacio">Este proyecto no tiene alcance cargado en la app.</p>}
      {d.baseMes && <p className="dsp-nota">H-H acumuladas = acumulado del RC-OP-43 al cierre de {textoMes(d.baseMes)} + horas de Toggl y Track después de esa fecha, según el área de cada persona en el Directorio{d.horasSinArea > 0.05 ? ` (${hrs(d.horasSinArea, 1)} de personas sin área no entran)` : ''}.</p>}

      {/* Concepto por concepto */}
      <h4 className="dsp-sub">Concepto por concepto: lo que se cobra contra las horas que cuesta</h4>
      {d.horasConcepto < 0.01 && (
        <p className="dsp-aviso">
          Todavía no hay horas registradas por concepto{email ? ' de esta persona' : ''}. Se llenan solas cuando el equipo registra en Track eligiendo el concepto del contrato
          {d.generales + d.sinConcepto > 0.01 ? ` (en este proyecto hay ${hrs(d.generales, 1)} en actividades generales y ${hrs(d.sinConcepto, 1)} sin concepto)` : ''}.
          Mientras tanto se ve cuánto vale cada concepto y cuántas H-H le tocan según el presupuesto.
        </p>
      )}
      {d.conceptos.length ? (
        <div className="dsp-tabla-wrap">
          <table className="dsp-tabla dsp-conceptos">
            <thead><tr>
              <th>Clave</th><th>Concepto</th><th>Área</th><th className="n">Monto</th><th className="n">Cobrado</th>
              <th className="n" title="Monto del concepto ÷ $/h plan del área">H-H plan</th><th className="n">Horas reales</th>
              <th className="n" title="Cobrado ÷ horas reales, contra el $/h plan. Si aún no se cobra: potencial = monto ÷ horas">$/h real</th>
              <th className="n" title="Avance del concepto ÷ consumo de sus H-H">Desviación</th>
            </tr></thead>
            <tbody>
              {visibles.map(c => {
                const rel = c.porHora != null && c.porHoraPres ? c.porHora / c.porHoraPres : null
                return (
                  <tr key={c.id} className={c.estado === 'Cobrado' ? 'cobrado' : ''}>
                    <td><b>{c.key}</b></td>
                    <td className="desc" title={`${c.disciplina}${d.varios && !d.proyecto ? ' · ' + c.proyecto : ''}`}>{c.descripcion}</td>
                    <td className="sub">{ETQ[c.area]}</td>
                    <td className="n">{dinero(c.monto, c.moneda)}</td>
                    <td className="n">{c.cobrado > 0.5 ? dinero(c.cobrado, c.moneda) : '—'} <span className={`dsp-estado ${c.estado === 'Cobrado' ? 'ok' : c.estado === 'Parcial' ? 'medio' : ''}`}>{c.estado}</span></td>
                    <td className="n">{c.hhPres != null ? hrs(c.hhPres, 1) : '—'}</td>
                    <td className="n">{c.horas > 0.01 ? hrs(c.horas, 1) : '—'}</td>
                    <td className={`n ${tono(rel)}`}>{c.porHora != null ? `${dinero(c.porHora, c.moneda)} ${flecha(rel)}` : c.porHoraPotencial != null ? <span className="sub" title="Aún no se cobra: monto ÷ horas gastadas hasta hoy">{dinero(c.porHoraPotencial, c.moneda)} potencial</span> : '—'}</td>
                    <td className={`n ${tono(c.desviacion)}`}>{veces(c.desviacion)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {ocultos > 0 && <button className="btn btn-outline btn-sm no-print" style={{ marginTop: 6 }} onClick={() => setVerCobrados(true)}>Mostrar {ocultos} conceptos ya cobrados sin horas</button>}
        </div>
      ) : <p className="dsp-vacio">Sin conceptos en la app para este proyecto.</p>}

      <div className="dsp-dos">
        <div>
          <h4 className="dsp-sub">Actividades de Toggl (histórico del proyecto)</h4>
          {actividades === null ? <p className="dsp-vacio">Cargando…</p> : actividades.length ? (
            <ul className="dsp-reparto">
              {actividades.slice(0, 15).map(a => (
                <li key={a.id}><span className="nombre" title={a.nombre}>{a.nombre}</span><Barra valor={+a.horas_toggl} max={maxAct} /><span className="n">{hrs(+a.horas_toggl, 1)}</span></li>
              ))}
            </ul>
          ) : <p className="dsp-vacio">Sin actividades con horas en Toggl.</p>}
          <p className="dsp-nota">Acumulado de todo el equipo hasta la importación (26 nov 2026). Las actividades de Toggl son genéricas, no los conceptos del contrato.</p>
        </div>
        <div>
          <h4 className="dsp-sub">Quién trabajó en el proyecto</h4>
          {d.personas.length ? (
            <table className="dsp-tabla">
              <thead><tr><th>Persona</th><th>Área</th><th className="n">{textoMes(datos.mes)}</th><th className="n">12 meses</th></tr></thead>
              <tbody>{d.personas.slice(0, 12).map(p => (
                <tr key={p.nombre + p.email} className={email && p.email?.toLowerCase() === email.toLowerCase() ? 'resaltada' : ''}>
                  <td>{nombreCorto(p.nombre)}</td><td className="sub">{ETQ[p.area] || p.area || 'Sin área'}</td><td className="n">{hrs(p.mes, 1)}</td><td className="n">{hrs(p.total, 1)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="dsp-vacio">Sin horas en los últimos 12 meses.</p>}
        </div>
      </div>
    </div>
  )
}
