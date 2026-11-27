import { useEffect, useState } from 'react'
import { toast } from './Toast'
import { fmtMoney } from '../utils/format'
import { textoMes } from '../lib/proyecciones'
import { estadoConcepto, agregarAProyecciones, marcarCompletoEnBorrador } from '../lib/trackConcepto'

/** Bajo el cronómetro de Track: si el tiempo va a un concepto del contrato, ofrece proyectarlo o marcarlo completo en el borrador. */
export default function AccionesConceptoTrack({ projectId, conceptId }) {
  const [st, setSt] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setSt(null)
    if (!projectId || !conceptId) return
    let vivo = true
    estadoConcepto(projectId, conceptId).then(x => vivo && setSt(x)).catch(() => vivo && setSt(null))
    return () => { vivo = false }
  }, [projectId, conceptId, version])

  if (!st) return null
  const moneda = st.project.currency || 'MXN'
  const num = st.borrador ? `#${String(st.borrador.number).padStart(3, '0')}` : ''

  async function hacer(fn, ok) {
    setOcupado(true)
    try { const r = await fn(st); toast(ok(r)); setVersion(v => v + 1) } catch (e) { toast(e.message, true) }
    setOcupado(false)
  }

  return (
    <div className="acc-concepto-trk">
      <span className="txt">
        <b>{st.concept.key}</b> {st.cobrado ? '· ya se cobró completo' : `· por cobrar ${fmtMoney(st.porEstimar, moneda)}`}
      </span>
      {!st.cobrado && (
        <span className="btns">
          {st.proyectado
            ? <span className="hecho">✓ En proyecciones de {textoMes(st.mes)}</span>
            : <button className="btn btn-outline btn-sm" disabled={ocupado}
                title={st.mes !== st.mesEnTurno ? `Las proyecciones de ${textoMes(st.mesEnTurno)} ya están congeladas` : ''}
                onClick={() => hacer(agregarAProyecciones, () => `Agregado a proyecciones de ${textoMes(st.mes)} ✓`)}>
                📈 Agregar a proyecciones de {textoMes(st.mes)}
              </button>}
          {st.enBorrador
            ? <span className="hecho">✓ Completo en el borrador {num}</span>
            : <button className="btn btn-outline btn-sm" disabled={ocupado}
                onClick={() => hacer(marcarCompletoEnBorrador, r => `Marcado completo en el borrador #${String(r.estimacion.number).padStart(3, '0')} (${fmtMoney(r.monto, moneda)}) ✓`)}>
                ✓ Marcar completo en el borrador {num || 'de estimación'}
              </button>}
        </span>
      )}
    </div>
  )
}
