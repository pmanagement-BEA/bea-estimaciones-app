import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'
import { HORARIO, diaIso, hhmm, textoDiaLargo, textoHoras, fechaHora, aInstante, sumarDias, abierta, sinSalida } from '../lib/checador'

const TIPO = { laborable: 'Día laborable', descanso: 'Fin de semana', festivo: 'Día festivo' }
const textoFranjas = fs => (fs?.length ? fs.map(f => `${hhmm(f.entrada)}–${f.salida ? hhmm(f.salida) : '…'}`).join(', ') : 'sin franjas')

/**
 * Detalle de un día: horario de referencia, franjas checadas, totales e historial de ediciones.
 * Con `puedeEditar`, permite cambiar las franjas (queda marcado EDITADO, con motivo).
 */
export default function PanelDiaChecador({ dia, email, nombre, nombrePorEmail = {}, puedeEditar, onCerrar, onGuardado, anterior, siguiente }) {
  const [editando, setEditando] = useState(false)
  const [filas, setFilas] = useState([])
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const hoy = diaIso()

  function empezar() {
    setFilas(dia.franjas.map(f => ({ entrada: hhmm(f.entrada), salida: f.salida ? hhmm(f.salida) : '', orig: f })))
    setMotivo('')
    setEditando(true)
  }
  const cambiar = (i, k, v) => setFilas(fs => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)))
  const agregar = () => setFilas(fs => [...fs, { entrada: fs.length ? fs.at(-1).salida || '' : HORARIO.inicio, salida: '', orig: null }])
  const quitar = i => setFilas(fs => fs.filter((_, j) => j !== i))

  async function guardar() {
    if (!motivo.trim()) { toast('Escribe el motivo de la edición', true); return }
    if (filas.some(f => !f.entrada)) { toast('Cada franja necesita su hora de entrada', true); return }
    if (filas.some(f => f.salida && f.salida === f.entrada)) { toast('La salida no puede ser igual a la entrada', true); return }
    const tramos = filas.map(f => {
      const entrada = f.orig && hhmm(f.orig.entrada) === f.entrada ? f.orig.entrada : aInstante(dia.fecha, f.entrada)
      let salida = null
      if (f.salida) {
        if (f.orig?.salida && hhmm(f.orig.salida) === f.salida) salida = f.orig.salida
        else salida = aInstante(f.salida <= f.entrada ? sumarDias(dia.fecha, 1) : dia.fecha, f.salida) // salida después de medianoche
      }
      return { entrada, salida }
    })
    setGuardando(true)
    const { error } = await supabase.rpc('editar_dia', { p_email: email, p_fecha: dia.fecha, p_tramos: tramos, p_motivo: motivo.trim() })
    setGuardando(false)
    if (error) { toast(error.message, true); return }
    toast('Día editado ✓ (queda marcado como EDITADO)')
    setEditando(false)
    onGuardado?.()
  }

  const quien = e => nombrePorEmail[e] || (e === email ? nombre : e)

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget && !editando) onCerrar() }}>
      <aside className="panel-dia" role="dialog" aria-label={`Detalle del ${textoDiaLargo(dia.fecha)}`}>
        <header>
          <div>
            <div className="quien">{nombre}</div>
            <h2>{textoDiaLargo(dia.fecha)}</h2>
            <div className="etiquetas">
              <span className={`tipo-dia ${dia.tipo}`}>{TIPO[dia.tipo]}</span>
              {dia.ediciones.length > 0 && <span className="editado">EDITADO</span>}
            </div>
          </div>
          <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>

        <div className="cuerpo">
          <div className="bloque referencia">
            <div><span className="lbl">Horario de referencia</span>{dia.tipo === 'laborable' ? `${HORARIO.inicio} a ${HORARIO.fin} · ${HORARIO.horas} h` : 'No laborable'}</div>
          </div>

          {!editando ? (
            <>
              <div className="bloque">
                <div className="lbl">Franjas checadas</div>
                {dia.franjas.length === 0 ? <div className="vacio">Sin checadas este día.</div> : (
                  <ul className="franjas">
                    {dia.franjas.map(f => (
                      <li key={f.id} className={sinSalida(f) ? 'sin' : abierta(f) ? 'abierta' : ''}>
                        <span className="hm">{hhmm(f.entrada)}</span><span className="flecha">→</span>
                        <span className="hm">{f.salida ? hhmm(f.salida) : abierta(f) ? 'ahora' : 'sin salida'}</span>
                        <span className="dur">{f.salida || abierta(f) ? textoHoras((f.salida ? new Date(f.salida) : Date.now()) - new Date(f.entrada)) : '—'}</span>
                        {f.origen === 'manual' && <span className="manual" title="Capturada al editar el día">editada</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bloque totales">
                <div><span className="lbl">Horas</span><strong>{textoHoras(dia.ms)}</strong></div>
                <div><span className="lbl">Descansos</span>{textoHoras(dia.descansos)}</div>
                <div><span className="lbl">Diferencia</span><span className={dia.diferencia < 0 ? 'neg' : dia.diferencia > 0 ? 'pos' : ''}>{textoHoras(dia.diferencia, true)}</span></div>
              </div>
            </>
          ) : (
            <div className="bloque edicion">
              <div className="lbl">Franjas (hora de Monterrey)</div>
              {filas.length === 0 && <div className="vacio">Sin franjas: el día quedará vacío.</div>}
              {filas.map((f, i) => (
                <div className="fila-edicion" key={i}>
                  <label>Entrada<input type="time" value={f.entrada} onChange={e => cambiar(i, 'entrada', e.target.value)} /></label>
                  <label>Salida<input type="time" value={f.salida} onChange={e => cambiar(i, 'salida', e.target.value)} /></label>
                  <button type="button" className="quitar" onClick={() => quitar(i)} aria-label="Quitar franja">🗑</button>
                </div>
              ))}
              <button type="button" className="btn-agregar" onClick={agregar}>＋ Agregar franja</button>
              <div className="nota">Salida vacía solo en la última franja de hoy. Una salida menor que la entrada cuenta al día siguiente.</div>
              <label className="motivo">Motivo de la edición <span>(obligatorio, queda en el historial)</span>
                <textarea rows={2} maxLength={300} value={motivo} placeholder="Ej. Olvidé checar la salida" onChange={e => setMotivo(e.target.value)} />
              </label>
            </div>
          )}

          {dia.ediciones.length > 0 && (
            <div className="bloque historial">
              <div className="lbl">Historial de ediciones</div>
              {dia.ediciones.map(e => (
                <div key={e.id} className="edicion-item">
                  <div><span className="editado">EDITADO</span> por <strong>{quien(e.hecho_por)}</strong> · {fechaHora(e.hecho_en)}</div>
                  <div className="motivo-txt">“{e.motivo}”</div>
                  <div className="cambio"><span>Antes:</span> {textoFranjas(e.antes)}</div>
                  <div className="cambio"><span>Después:</span> {textoFranjas(e.despues)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer>
          {!editando ? (
            <>
              <div className="nav">
                <button className="btn btn-outline btn-sm" disabled={!anterior} onClick={anterior} aria-label="Día anterior">‹</button>
                <button className="btn btn-outline btn-sm" disabled={!siguiente} onClick={siguiente} aria-label="Día siguiente">›</button>
              </div>
              {puedeEditar && dia.fecha <= hoy && <button className="btn btn-primary btn-sm" onClick={empezar}>✎ Editar día</button>}
            </>
          ) : (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar edición'}</button>
            </>
          )}
        </footer>
      </aside>
    </div>
  )
}
