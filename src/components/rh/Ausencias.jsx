import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../Toast'
import { diaIso, textoDia } from '../../lib/checador'
import { ESTADOS, textoEstado, diasLaborables, textoDias, saldo, cargarAusencias } from '../../lib/ausencias'

const fechaCorta = f => `${textoDia(f)} ${f.slice(0, 4)}`
export const Periodo = ({ a }) => <>{a.inicio === a.fin ? fechaCorta(a.inicio) : <>{fechaCorta(a.inicio)} → {fechaCorta(a.fin)}</>}</>
export const ChipMotivo = ({ m }) => <span className="chip-motivo"><span className="pt" style={{ background: m?.color || '#94A3B8' }} />{m?.nombre || 'Motivo'}</span>
export const ChipEstado = ({ a }) => <span className={`chip-estado ${ESTADOS[a.estado]?.clase || ''}`}>{textoEstado(a)}</span>

/** Saldo de un motivo con días (Vacaciones): disponibles grande, el resto abajo. */
export function TarjetaSaldo({ motivo, s }) {
  return (
    <div className="saldo-rh">
      <div className="titulo"><ChipMotivo m={motivo} /></div>
      <div className={`disp ${s.disponibles < 0 ? 'neg' : ''}`}>{textoDias(s.disponibles)}<span>disponibles</span></div>
      <div className="desglose">
        <span><b>{+s.asignados}</b> asignados</span><span><b>{+s.dispuestos}</b> disfrutados o aprobados</span>{s.pendientes > 0 && <span><b>{+s.pendientes}</b> por aprobar</span>}
      </div>
    </div>
  )
}

/**
 * Formulario de solicitud. Para un administrador con `personas`, puede registrarla a nombre de otra persona (queda aprobada).
 */
export function FormAusencia({ motivos, email, personas = null, asignaciones = [], ausencias = [], onListo, onCancelar }) {
  const activos = motivos.filter(m => m.activo)
  const [f, setF] = useState({ motivo: activos[0]?.id || '', inicio: '', fin: '', obs: '', email: email || '' })
  const [guardando, setGuardando] = useState(false)
  const m = activos.find(x => x.id === +f.motivo)
  const n = diasLaborables(f.inicio, f.fin || f.inicio)
  const propias = { a: asignaciones.filter(x => x.email === f.email), b: ausencias.filter(x => x.email === f.email) }
  const s = m?.con_saldo ? saldo(m.id, propias.a, propias.b) : null

  async function guardar() {
    if (!f.motivo || !f.inicio) { toast('Elige el motivo y la fecha de inicio', true); return }
    if (personas && !f.email) { toast('Elige la persona', true); return }
    setGuardando(true)
    const { error } = await supabase.rpc('solicitar_ausencia', { p_motivo: +f.motivo, p_inicio: f.inicio, p_fin: f.fin || f.inicio, p_observaciones: f.obs, p_email: personas ? f.email : null })
    setGuardando(false)
    if (error) { toast(error.message, true); return }
    toast(personas && f.email !== email ? 'Ausencia registrada (aprobada) ✓' : 'Solicitud enviada ✓ Queda pendiente de aprobación')
    onListo?.()
  }

  return (
    <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && onCancelar()}>
      <div className="modal-rh" role="dialog" aria-label="Solicitar ausencia">
        <header><h2>{personas ? 'Registrar ausencia' : 'Solicitar ausencia'}</h2><button className="cerrar" onClick={onCancelar} aria-label="Cerrar">✕</button></header>
        <div className="cuerpo">
          {personas && (
            <label className="campo">Persona
              <select value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))}>
                <option value="">— Elige —</option>
                {personas.map(p => <option key={p.email} value={p.email}>{p.nombre}</option>)}
              </select>
              {f.email && f.email !== email && <span className="ayuda">Registrada por un administrador: queda aprobada.</span>}
            </label>
          )}
          <label className="campo">Motivo
            <select value={f.motivo} onChange={e => setF(x => ({ ...x, motivo: e.target.value }))}>
              {activos.map(x => <option key={x.id} value={x.id}>{x.nombre}{x.con_saldo ? ' (con saldo)' : ''}</option>)}
            </select>
          </label>
          {s && <TarjetaSaldo motivo={m} s={s} />}
          <div className="dos">
            <label className="campo">Fecha inicio<input type="date" value={f.inicio} onChange={e => setF(x => ({ ...x, inicio: e.target.value, fin: x.fin && x.fin < e.target.value ? e.target.value : x.fin }))} /></label>
            <label className="campo">Fecha fin<input type="date" value={f.fin} min={f.inicio || undefined} onChange={e => setF(x => ({ ...x, fin: e.target.value }))} /></label>
          </div>
          {f.inicio && (
            <div className={`resumen-dias ${n === 0 ? 'cero' : ''}`}>
              {n === 0 ? 'En esas fechas no hay días laborables.' : <>Son <b>{textoDias(n)} laborables</b> (sin fines de semana ni festivos).</>}
              {s && n > 0 && s.disponibles - n < 0 && (() => {
                const conGoce = Math.max(0, Math.min(n, s.disponibles))
                return <div className="aviso">⚠ {conGoce > 0
                  ? <>Tienes {textoDias(s.disponibles)} de {m.nombre.toLowerCase()}: <b>{textoDias(conGoce)} con goce</b> y <b>{textoDias(n - conGoce)} sin goce de sueldo</b>.</>
                  : <>No tienes días de {m.nombre.toLowerCase()} disponibles: <b>los {textoDias(n)} serán sin goce de sueldo</b>.</>}</div>
              })()}
            </div>
          )}
          <label className="campo">Observaciones (opcional)
            <textarea rows={3} maxLength={300} value={f.obs} placeholder="Ej. Días negociados en la contratación" onChange={e => setF(x => ({ ...x, obs: e.target.value }))} />
            <span className="contador">{f.obs.length}/300</span>
          </label>
        </div>
        <footer>
          <button className="btn btn-outline btn-sm" onClick={onCancelar} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando || !f.inicio || n === 0}>{guardando ? 'Guardando…' : personas ? 'Registrar' : 'Enviar solicitud'}</button>
        </footer>
      </div>
    </div>
  )
}

/** Lista de solicitudes con su estado, comentario de quien resolvió y botón de cancelar. */
export function ListaSolicitudes({ lista, motivosPorId, nombres = {}, mostrarPersona = false, puedeCancelar, alCancelar }) {
  if (!lista.length) return <div className="vacio-chk">No hay solicitudes.</div>
  return (
    <ul className="lista-rh">
      {lista.map(a => (
        <li key={a.id} className={a.estado}>
          <div className="izq">
            {mostrarPersona && <div className="persona">{nombres[a.email] || a.email}</div>}
            <div className="linea"><ChipMotivo m={motivosPorId[a.motivo_id]} /><span className="dias">{textoDias(a.dias)}</span>{+a.dias_sin_goce > 0 && <span className="chip-sin-goce">{textoDias(a.dias_sin_goce)} sin goce de sueldo</span>}</div>
            <div className="fechas"><Periodo a={a} /></div>
            {a.observaciones && <div className="obs">“{a.observaciones}”</div>}
            {a.resuelto_por && a.estado !== 'pendiente' && (
              <div className="resolucion">{textoEstado(a)} por {nombres[a.resuelto_por] || a.resuelto_por}{a.comentario ? `: ${a.comentario}` : ''}</div>
            )}
          </div>
          <div className="der">
            <ChipEstado a={a} />
            {puedeCancelar?.(a) && <button className="link-chk" onClick={() => alCancelar(a)}>Cancelar</button>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Vista de la persona: saldos, solicitar y sus solicitudes. */
export default function MisAusencias({ email, motivos, nombres }) {
  const [datos, setDatos] = useState(null)
  const [nueva, setNueva] = useState(false)
  const [filtro, setFiltro] = useState('vigentes')
  const motivosPorId = useMemo(() => Object.fromEntries(motivos.map(m => [m.id, m])), [motivos])
  const hoy = diaIso()

  async function cargar() {
    try { setDatos(await cargarAusencias(email)) } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ ausencias: [], asignaciones: [] }) }
  }
  useEffect(() => { cargar() }, [email])

  async function cancelar(a) {
    if (!window.confirm('¿Cancelar esta solicitud?')) return
    const { error } = await supabase.rpc('cancelar_ausencia', { p_id: a.id })
    if (error) { toast(error.message, true); return }
    toast('Solicitud cancelada'); cargar()
  }

  if (!datos) return <div className="vacio-chk">Cargando…</div>
  const conSaldo = motivos.filter(m => m.con_saldo)
  const lista = datos.ausencias.filter(a => filtro === 'todas' || (filtro === 'vigentes' ? ['pendiente', 'aprobada'].includes(a.estado) && a.fin >= hoy : a.estado === filtro || (filtro === 'pasadas' && a.fin < hoy)))
  const proximas = datos.ausencias.filter(a => a.estado === 'aprobada' && a.fin >= hoy).sort((x, y) => x.inicio.localeCompare(y.inicio))

  return (
    <>
      <div className="cab-rh">
        <div className="saldos-rh">
          {conSaldo.map(m => <TarjetaSaldo key={m.id} motivo={m} s={saldo(m.id, datos.asignaciones, datos.ausencias)} />)}
          <div className="saldo-rh proxima">
            <div className="titulo">Próxima ausencia</div>
            {proximas[0] ? <><div className="disp sm"><Periodo a={proximas[0]} /></div><div className="desglose"><ChipMotivo m={motivosPorId[proximas[0].motivo_id]} /> · {textoDias(proximas[0].dias)}</div></> : <div className="desglose">Ninguna aprobada.</div>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setNueva(true)}>＋ Solicitar ausencia</button>
      </div>
      {conSaldo.length > 0 && datos.asignaciones.length === 0 && <div className="aviso-chk">Todavía no tienes días asignados en la app (los saldos de Woffu se van a importar). Puedes solicitar de todos modos.</div>}

      <div className="section-header" style={{ marginTop: 18 }}><span className="section-title">Mis solicitudes</span></div>
      <div className="filtros-rh">
        {[['vigentes', 'Vigentes'], ['pendiente', 'Pendientes'], ['pasadas', 'Pasadas'], ['rechazada', 'Rechazadas'], ['todas', 'Todas']].map(([k, t]) => (
          <button key={k} className={filtro === k ? 'activo' : ''} onClick={() => setFiltro(k)}>{t}</button>
        ))}
      </div>
      <ListaSolicitudes lista={lista} motivosPorId={motivosPorId} nombres={nombres}
        puedeCancelar={a => a.estado === 'pendiente' || (a.estado === 'aprobada' && a.inicio > hoy)} alCancelar={cancelar} />

      {nueva && <FormAusencia motivos={motivos} email={email} asignaciones={datos.asignaciones} ausencias={datos.ausencias} onCancelar={() => setNueva(false)} onListo={() => { setNueva(false); cargar() }} />}
    </>
  )
}
