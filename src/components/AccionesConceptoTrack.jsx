import { useEffect, useState } from 'react'
import { toast } from './Toast'
import { fmtMoney } from '../utils/format'
import { textoMes } from '../lib/proyecciones'
import { estadoConcepto, agregarAProyecciones, marcarCompletoEnBorrador } from '../lib/trackConcepto'

/**
 * Al elegir un concepto del contrato en Track: cómo va (¿cobrado? ¿proyectado? ¿en el borrador?)
 * y, si falta, botones para proyectarlo o marcarlo completo en el borrador de estimación.
 */
export default function AccionesConceptoTrack({ projectId, conceptId, onCambio }) {
  const [st, setSt] = useState(undefined)
  const [ocupado, setOcupado] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setSt(undefined)
    if (!projectId || !conceptId) return
    let vivo = true
    estadoConcepto(projectId, conceptId).then(x => vivo && setSt(x)).catch(() => vivo && setSt(null))
    return () => { vivo = false }
  }, [projectId, conceptId, version])

  if (!projectId || !conceptId || st === null) return null
  if (st === undefined) return <div className="acc-concepto-trk"><span className="txt">Revisando el concepto…</span></div>
  const moneda = st.project.currency || 'MXN'
  const num = st.borrador ? `#${String(st.borrador.number).padStart(3, '0')}` : ''

  async function hacer(fn, ok) {
    setOcupado(true)
    try { const r = await fn(st); toast(ok(r)); setVersion(v => v + 1); onCambio?.() } catch (e) { toast(e.message, true) }
    setOcupado(false)
  }

  return (
    <div className="acc-concepto-trk">
      <span className="txt"><b>{st.concept.key}</b> {st.concept.description}</span>
      <span className="estados">
        <span className={`chip ${st.cobrado ? 'si' : 'no'}`}>{st.cobrado ? '✓ Cobrado' : `Cobrado: falta ${fmtMoney(st.porEstimar, moneda)}`}</span>
        {!st.cobrado && <span className={`chip ${st.proyectado ? 'si' : 'no'}`}>{st.proyectado ? `✓ Proyectado ${textoMes(st.proyectado.mes)}` : 'Sin proyectar'}</span>}
        {!st.cobrado && <span className={`chip ${st.enBorrador && !st.borradorParcial ? 'si' : 'no'}`}>{st.enBorrador ? (st.borradorParcial ? `Parcial en el borrador ${num}` : `✓ En el borrador ${num}`) : 'No está en el borrador'}</span>}
      </span>
      {!st.cobrado && (!st.proyectado || !st.enBorrador || st.borradorParcial) && (
        <span className="btns">
          {!st.proyectado && (
            <button type="button" className="btn btn-outline btn-sm" disabled={ocupado}
              title={st.mes !== st.mesEnTurno ? `Las proyecciones de ${textoMes(st.mesEnTurno)} ya están congeladas` : ''}
              onClick={() => hacer(agregarAProyecciones, () => `Proyectado en ${textoMes(st.mes)} ✓`)}>
              📈 Proyectar en {textoMes(st.mes)}
            </button>
          )}
          {(!st.enBorrador || st.borradorParcial) && (
            <button type="button" className="btn btn-outline btn-sm" disabled={ocupado}
              onClick={() => hacer(marcarCompletoEnBorrador, r => `Completo en el borrador #${String(r.estimacion.number).padStart(3, '0')} (${fmtMoney(r.monto, moneda)}) ✓`)}>
              ✓ Marcar completo en el borrador {num}
            </button>
          )}
        </span>
      )}
    </div>
  )
}
