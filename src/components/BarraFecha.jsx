import { textoDiaLargo, sumarDias, diaIso, nombreDia } from '../lib/checador'

/** Día del reporte: flechas, calendario y Actualizar */
export default function BarraFecha({ fecha, setFecha, onActualizar, extra }) {
  return (
    <div className="rd-barra-fecha">
      <div className="rd-dia">{fecha ? textoDiaLargo(fecha) : ''}{fecha && nombreDia(fecha) ? <span className="sub"> · {nombreDia(fecha)}</span> : null}</div>
      <div className="rd-controles">
        {extra}
        <button className="btn btn-outline btn-sm" onClick={() => setFecha(sumarDias(fecha, -1))} disabled={!fecha} aria-label="Día anterior">‹</button>
        <input type="date" className="input" value={fecha || ''} max={diaIso()} onChange={e => e.target.value && setFecha(e.target.value)} aria-label="Día del reporte" />
        <button className="btn btn-outline btn-sm" onClick={() => setFecha(sumarDias(fecha, 1))} disabled={!fecha || fecha >= diaIso()} aria-label="Día siguiente">›</button>
        {onActualizar && <button className="btn btn-outline btn-sm" onClick={onActualizar}>Actualizar</button>}
      </div>
    </div>
  )
}
