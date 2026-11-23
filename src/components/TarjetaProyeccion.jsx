import { COLOR_AREA } from '../lib/proyecciones'
import { fmtMoney } from '../utils/format'

const sinMonto = c => !(c.monto > 0)

/**
 * Tarjeta de un proyecto para un mes: sus conceptos proyectados a la vista, los que no tienen monto al final.
 * Con `estimado` (meses pasados o el mes en curso) marca qué se estimó de verdad y el cumplimiento.
 * conceptos: [{ k, area, clave, texto, monto, quien }]; estimado: { k: $ } o null
 */
export default function TarjetaProyeccion({ p, lider, equipo = [], conceptos, estimado = null, alAbrir, alAgregar = null, cerrado = false, aviso = null }) {
  // Lo que se estimó en el mes de conceptos que no estaban proyectados
  const fuera = estimado ? Object.entries(estimado).filter(([k]) => !conceptos.some(c => c.k === k)).reduce((s, [, v]) => s + v, 0) : 0
  const conMonto = conceptos.filter(c => !sinMonto(c))
  const faltan = conceptos.filter(sinMonto)
  const total = conMonto.reduce((s, c) => s + c.monto, 0)
  const moneda = p.currency || 'MXN'
  const est = estimado ? conceptos.reduce((s, c) => s + (estimado[c.k] || 0), 0) : 0
  const fila = c => {
    const e = estimado?.[c.k] || 0
    return (
      <li key={c.k} className={sinMonto(c) ? 'sin-monto' : ''}>
        <span className="punto" style={{ background: COLOR_AREA[c.area] }} title={c.area} />
        <span className="txt" title={c.texto}>{c.clave && <strong>{c.clave}</strong>} {c.texto || '—'}</span>
        <span className="quien">{c.quien}</span>
        <span className="monto">{sinMonto(c) ? 'sin monto' : fmtMoney(c.monto, moneda)}</span>
        {estimado && <span className={`est ${e > 0 ? 'si' : 'no'}`}>{e > 0 ? `✓ ${fmtMoney(e, moneda)}` : cerrado ? '✗ no se estimó' : '· por estimar'}</span>}
      </li>
    )
  }
  return (
    <div className="tarjeta-proy">
      <div className="cab">
        <div>
          <a onClick={alAbrir} className="nombre">{p.name}</a>
          <div className="sub">{lider ? <>Responsable: <strong>{lider}</strong></> : <span style={{ color: 'var(--text-soft)' }}>Sin líder asignado</span>}{moneda === 'USD' && ' · USD'}</div>
          {equipo.length > 0 && <div className="sub equipo">Equipo: {equipo.join(' · ')}</div>}
        </div>
        <div className="totales">
          <div className="total">{fmtMoney(total, moneda)}</div>
          {estimado && (cerrado || est > 0)
            ? <div className="sub">estimado {fmtMoney(est, moneda)}{total > 0 ? ` · ${Math.round((est / total) * 100)}%` : ''}</div>
            : <div className="sub">{conMonto.length} {conMonto.length === 1 ? 'concepto' : 'conceptos'}</div>}
        </div>
      </div>
      {aviso && <div className="aviso-estado">⚠ {aviso}</div>}
      {conMonto.length > 0 && <ul className="conceptos">{conMonto.map(fila)}</ul>}
      {faltan.length > 0 && (
        <details className="faltan" open={conMonto.length === 0}>
          <summary>{faltan.length} {faltan.length === 1 ? 'concepto proyectado' : 'conceptos proyectados'} todavía sin monto</summary>
          <ul className="conceptos">{faltan.map(fila)}</ul>
        </details>
      )}
      {alAgregar && <button className="btn-agregar" onClick={alAgregar}>＋ Agregar concepto a este mes</button>}
      {fuera > 0.5 && <div className="fuera">+ {fmtMoney(fuera, moneda)} estimado de conceptos que no estaban proyectados</div>}
    </div>
  )
}
