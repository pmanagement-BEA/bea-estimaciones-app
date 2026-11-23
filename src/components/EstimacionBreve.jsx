import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { armarBreve } from '../lib/estimacionBreve'

const BASE = import.meta.env.BASE_URL || '/'
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Versión breve imprimible (carta vertical): solo los conceptos cobrados en esta estimación. */
export default function EstimacionBreve({ hoja, elaboradoPor }) {
  const b = armarBreve(hoja)
  const m = v => fmtMoney(v, b.moneda)
  return (
    <div className="estimacion-breve">
      <div className="eb-encabezado">
        <img src={`${BASE}formatos/logo-bea.png`} alt="BEA" />
        <div className="eb-datos">
          <strong>{b.proyecto}</strong><br />
          Cliente: {b.cliente || '—'}<br />
          Periodo: {fmtDate(b.periodFrom)} — {fmtDate(b.periodTo)}
        </div>
      </div>
      <h1 className="eb-titulo">{b.titulo}</h1>

      <h2 className="eb-h2">Resumen Financiero</h2>
      <div className="eb-tarjetas">
        {b.tarjetas.map(([etq, v, tipo, verde]) => (
          <div key={etq} className="eb-tarjeta">
            <div className="eb-etq">{etq}</div>
            <div className={`eb-valor${verde ? ' verde' : ''}`}>{tipo === 'pct' ? fmtPct(v) : m(v)}</div>
          </div>
        ))}
      </div>

      <h2 className="eb-h2">Avance por Disciplina</h2>
      <div className="eb-tarjetas">
        {b.avances.map((a, i) => (
          <div key={i} className={`eb-tarjeta chica${a.pct == null ? ' inactiva' : ''}`}>
            <div className="eb-etq">{a.nombre}</div>
            <div className="eb-valor">{a.pct == null ? '—' : fmtPct(a.pct)}</div>
            {a.pct != null && <div className="eb-barra"><div style={{ width: `${Math.min(100, a.pct)}%` }} /></div>}
          </div>
        ))}
      </div>

      <h2 className="eb-h2">Conceptos Incluidos en esta Estimación</h2>
      {b.bloques.length === 0 && <div className="eb-vacio">Esta estimación todavía no tiene conceptos cobrados.</div>}
      {b.bloques.map((bl, i) => (
        <div key={i} className="eb-bloque">
          <div className="eb-disciplina">{bl.nombre} — Estimable: {m(bl.estimable)}</div>
          <table className="eb-tabla">
            <thead>
              <tr>
                <th>Clave</th><th>Descripción</th>
                <th className="num">Monto total</th><th className="num">Ant. anterior</th><th className="num">Esta est.</th>
                <th className="num">Acumulado</th><th className="num">Por estimar</th>
              </tr>
            </thead>
            <tbody>
              {bl.filas.map((f, j) => (
                <tr key={j} className={f.finiquito ? 'fin' : ''}>
                  <td><strong>{f.clave}</strong>{f.finiquito && <span className="eb-tag">FIN</span>}</td>
                  <td>{f.concepto}</td>
                  <td className="num">{m(f.monto)}</td>
                  <td className="num">{m(f.anterior)}</td>
                  <td className="num verde">{m(f.esta)}</td>
                  <td className="num">{m(f.acumulado)}</td>
                  <td className="num">{m(f.porEstimar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="eb-pie">
        <span>Estimación #{b.numero} · {b.proyecto}</span>
        <span>Generado: {fmtDate(hoy())} · Elaborado por: {elaboradoPor || '—'}</span>
      </div>
    </div>
  )
}
