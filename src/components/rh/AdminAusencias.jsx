import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../Toast'
import { diaIso } from '../../lib/checador'
import { saldo, textoDias, cargarAusencias } from '../../lib/ausencias'
import { FormAusencia, ListaSolicitudes, ChipMotivo, Periodo } from './Ausencias'

/** Una solicitud pendiente con sus botones de aprobar y rechazar. */
function PorAprobar({ a, persona, motivo, s, alResolver, propia }) {
  const [rechazando, setRechazando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function resolver(aprobar) {
    setOcupado(true)
    const { error } = await supabase.rpc('resolver_ausencia', { p_id: a.id, p_aprobar: aprobar, p_comentario: comentario })
    setOcupado(false)
    if (error) { toast(error.message, true); return }
    toast(aprobar ? 'Solicitud aprobada ✓' : 'Solicitud rechazada'); alResolver()
  }
  return (
    <div className="por-aprobar">
      <div className="info">
        <div className="persona">{persona}</div>
        <div className="linea"><ChipMotivo m={motivo} /> <b>{textoDias(a.dias)}</b> · <Periodo a={a} /></div>
        {a.observaciones && <div className="obs">“{a.observaciones}”</div>}
        {s && <div className={`saldo-linea ${s.disponibles < 0 ? 'neg' : ''}`}>Saldo de {motivo.nombre}: {textoDias(s.disponibles)} disponibles (ya contando esta)</div>}
      </div>
      {propia ? <div className="sub">Tu solicitud: la aprueba otro administrador</div> : !rechazando ? (
        <div className="acciones">
          <button className="btn btn-outline btn-sm" onClick={() => setRechazando(true)} disabled={ocupado}>Rechazar</button>
          <button className="btn btn-primary btn-sm" onClick={() => resolver(true)} disabled={ocupado}>Aprobar</button>
        </div>
      ) : (
        <div className="rechazo">
          <textarea rows={2} maxLength={300} placeholder="Motivo del rechazo (obligatorio)" value={comentario} onChange={e => setComentario(e.target.value)} autoFocus />
          <div className="acciones">
            <button className="btn btn-outline btn-sm" onClick={() => setRechazando(false)}>Volver</button>
            <button className="btn btn-sm rojo" onClick={() => resolver(false)} disabled={ocupado || !comentario.trim()}>Rechazar solicitud</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Saldos: una fila por persona y por motivo con saldo; asignar días o ajustar. */
function Saldos({ personas, motivos, datos, nombres, yo, alCambiar }) {
  const conSaldo = motivos.filter(m => m.con_saldo)
  const [motivoId, setMotivoId] = useState(conSaldo[0]?.id || null)
  const [form, setForm] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const [buscar, setBuscar] = useState('')
  const m = conSaldo.find(x => x.id === motivoId)
  if (!m) return <div className="vacio-chk">Ningún motivo lleva saldo. Márcalo en “Motivos”.</div>
  const q = buscar.trim().toLowerCase()
  const filas = personas.filter(p => !q || p.nombre.toLowerCase().includes(q)).map(p => ({ p, s: saldo(m.id, datos.asignaciones.filter(a => a.email === p.email), datos.ausencias.filter(a => a.email === p.email)) }))

  async function guardar() {
    if (!form.email || !(+form.dias)) { toast('Elige la persona y los días', true); return }
    const { error } = await supabase.from('ausencia_asignaciones').insert({ email: form.email, motivo_id: m.id, dias: +form.dias, inicio: form.inicio || null, fin: form.fin || null, nota: form.nota.trim(), creado_por: yo })
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    toast('Días asignados ✓'); setForm(null); alCambiar()
  }
  async function quitar(a) {
    if (!window.confirm(`¿Quitar la asignación de ${textoDias(a.dias)}?`)) return
    const { error } = await supabase.from('ausencia_asignaciones').delete().eq('id', a.id)
    if (error) { toast(error.message, true); return }
    alCambiar()
  }

  return (
    <>
      <div className="barra-rh">
        {conSaldo.length > 1 && <select value={motivoId} onChange={e => setMotivoId(+e.target.value)}>{conSaldo.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>}
        <input className="buscar-chk" placeholder="Buscar persona…" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => setForm({ email: '', dias: '', inicio: '', fin: '', nota: '' })}>＋ Asignar días</button>
      </div>
      <div className="aviso-chk">📥 Pendiente: importar los saldos de cada persona desde Woffu (se necesita la exportación de la cuenta de administrador de Woffu). Mientras, se pueden capturar aquí.</div>
      {form && (
        <div className="form-asignar">
          <select value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} aria-label="Persona"><option value="">— Persona —</option>{personas.map(p => <option key={p.email} value={p.email}>{p.nombre}</option>)}</select>
          <input type="number" step="0.5" placeholder="Días (ej. 12, o −1 para ajustar)" value={form.dias} onChange={e => setForm(f => ({ ...f, dias: e.target.value }))} aria-label="Días" />
          <label>Desde<input type="date" value={form.inicio} onChange={e => setForm(f => ({ ...f, inicio: e.target.value }))} /></label>
          <label>Hasta<input type="date" value={form.fin} onChange={e => setForm(f => ({ ...f, fin: e.target.value }))} /></label>
          <input placeholder="Nota (ej. Vacaciones 2027 por antigüedad)" value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} aria-label="Nota" />
          <div className="acciones"><button className="btn btn-outline btn-sm" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={guardar}>Guardar</button></div>
        </div>
      )}
      <div className="tabla-chk-wrap">
        <table className="tabla-chk admin">
          <thead><tr><th>Persona</th><th className="num">Asignados</th><th className="num">Aprobados</th><th className="num">Pendientes</th><th className="num">Disponibles</th></tr></thead>
          <tbody>
            {filas.map(({ p, s }) => {
              const ab = abierto === p.email
              const asig = datos.asignaciones.filter(a => a.email === p.email && a.motivo_id === m.id)
              return [
                <tr key={p.email} className={`persona ${s.asignados ? '' : 'sin-horas'}`} onClick={() => setAbierto(ab ? null : p.email)}>
                  <td><span className="flecha">{ab ? '▾' : '▸'}</span> <strong>{p.nombre}</strong></td>
                  <td className="num">{+s.asignados}</td><td className="num">{+s.dispuestos}</td><td className="num">{+s.pendientes || ''}</td>
                  <td className={`num ${s.disponibles < 0 ? 'neg-txt' : ''}`}><strong>{+s.disponibles}</strong></td>
                </tr>,
                ab && (
                  <tr key={p.email + '-d'} className="detalle"><td colSpan={5}>
                    {asig.length === 0 ? <span className="sub">Sin asignaciones.</span> : (
                      <ul className="asignaciones">{asig.map(a => (
                        <li key={a.id}><b>{+a.dias > 0 ? '+' : ''}{textoDias(a.dias)}</b>{a.inicio || a.fin ? <span className="sub"> · {a.inicio || '…'} a {a.fin || '…'}</span> : null}{a.nota && <span> · {a.nota}</span>}<span className="sub"> · {nombres[a.creado_por] || a.creado_por}</span><button className="quitar" onClick={() => quitar(a)} aria-label="Quitar">✕</button></li>
                      ))}</ul>
                    )}
                  </td></tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Motivos de ausencia: agregar, renombrar, color, con saldo, activo. */
function Motivos({ motivos, alCambiar }) {
  const [nuevo, setNuevo] = useState({ nombre: '', con_saldo: false, color: '#8B5CF6' })
  async function agregar() {
    if (!nuevo.nombre.trim()) { toast('Escribe el nombre del motivo', true); return }
    const { error } = await supabase.from('ausencia_motivos').insert({ ...nuevo, nombre: nuevo.nombre.trim() })
    if (error) { toast(/duplicate|unique/.test(error.message) ? 'Ese motivo ya existe' : error.message, true); return }
    toast('Motivo agregado ✓'); setNuevo({ nombre: '', con_saldo: false, color: '#8B5CF6' }); alCambiar()
  }
  async function cambiar(m, campos) {
    const { error } = await supabase.from('ausencia_motivos').update(campos).eq('id', m.id)
    if (error) { toast(error.message, true); return }
    alCambiar()
  }
  return (
    <>
      <div className="form-motivo">
        <input placeholder="Nuevo motivo (ej. Home office)" value={nuevo.nombre} onChange={e => setNuevo(n => ({ ...n, nombre: e.target.value }))} aria-label="Nombre del motivo" />
        <label className="chk"><input type="checkbox" checked={nuevo.con_saldo} onChange={e => setNuevo(n => ({ ...n, con_saldo: e.target.checked }))} /> Lleva saldo de días</label>
        <input type="color" value={nuevo.color} onChange={e => setNuevo(n => ({ ...n, color: e.target.value }))} aria-label="Color" />
        <button className="btn btn-primary btn-sm" onClick={agregar}>＋ Agregar motivo</button>
      </div>
      <ul className="lista-motivos">
        {motivos.map(m => (
          <li key={m.id} className={m.activo ? '' : 'inactivo'}>
            <input type="color" value={m.color} onChange={e => cambiar(m, { color: e.target.value })} aria-label={`Color de ${m.nombre}`} />
            <input className="nombre" defaultValue={m.nombre} onBlur={e => e.target.value.trim() && e.target.value.trim() !== m.nombre && cambiar(m, { nombre: e.target.value.trim() })} aria-label="Nombre" />
            <label className="chk"><input type="checkbox" checked={m.con_saldo} onChange={e => cambiar(m, { con_saldo: e.target.checked })} /> Con saldo</label>
            <label className="chk"><input type="checkbox" checked={m.activo} onChange={e => cambiar(m, { activo: e.target.checked })} /> Activo</label>
          </li>
        ))}
      </ul>
      <p className="ayuda">Un motivo inactivo ya no se puede elegir, pero las solicitudes que lo usan se conservan.</p>
    </>
  )
}

/** Administración de ausencias: por aprobar, todas, saldos y motivos. */
export default function AdminAusencias({ yo, motivos, recargarMotivos, nombres, personas }) {
  const [vista, setVista] = useState('aprobar')
  const [datos, setDatos] = useState(null)
  const [registrar, setRegistrar] = useState(false)
  const [filtro, setFiltro] = useState({ persona: '', estado: '', motivo: '' })
  const motivosPorId = useMemo(() => Object.fromEntries(motivos.map(m => [m.id, m])), [motivos])
  const hoy = diaIso()

  async function cargar() {
    try { setDatos(await cargarAusencias()) } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ ausencias: [], asignaciones: [] }) }
  }
  useEffect(() => { cargar() }, [])

  async function cancelar(a) {
    if (!window.confirm(`¿Cancelar la ausencia de ${nombres[a.email] || a.email}?`)) return
    const { error } = await supabase.rpc('cancelar_ausencia', { p_id: a.id })
    if (error) { toast(error.message, true); return }
    toast('Cancelada'); cargar()
  }

  if (!datos) return <div className="vacio-chk">Cargando…</div>
  const pendientes = datos.ausencias.filter(a => a.estado === 'pendiente').sort((x, y) => x.inicio.localeCompare(y.inicio))
  const fuera = datos.ausencias.filter(a => a.estado === 'aprobada' && a.inicio <= hoy && a.fin >= hoy)
  const todas = datos.ausencias.filter(a => (!filtro.persona || a.email === filtro.persona) && (!filtro.estado || a.estado === filtro.estado) && (!filtro.motivo || a.motivo_id === +filtro.motivo))

  return (
    <>
      <div className="subpestanas-rh">
        {[['aprobar', `Por aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`], ['todas', 'Todas las solicitudes'], ['saldos', 'Saldos de días'], ['motivos', 'Motivos']].map(([k, t]) => (
          <button key={k} className={vista === k ? 'activa' : ''} onClick={() => setVista(k)}>{t}</button>
        ))}
        <button className="btn btn-outline btn-sm registrar" onClick={() => setRegistrar(true)}>＋ Registrar ausencia</button>
      </div>

      {vista === 'aprobar' && (
        <>
          {fuera.length > 0 && <div className="fuera-hoy">Hoy están ausentes: {fuera.map(a => <span key={a.id} className="persona-chip">{nombres[a.email] || a.email} · {motivosPorId[a.motivo_id]?.nombre}</span>)}</div>}
          {pendientes.length === 0 ? <div className="vacio-chk">No hay solicitudes por aprobar. 🎉</div> : pendientes.map(a => {
            const m = motivosPorId[a.motivo_id]
            const s = m?.con_saldo ? saldo(m.id, datos.asignaciones.filter(x => x.email === a.email), datos.ausencias.filter(x => x.email === a.email)) : null
            return <PorAprobar key={a.id} a={a} persona={nombres[a.email] || a.email} motivo={m} s={s} alResolver={cargar} propia={a.email === yo} />
          })}
        </>
      )}

      {vista === 'todas' && (
        <>
          <div className="barra-rh">
            <select value={filtro.persona} onChange={e => setFiltro(f => ({ ...f, persona: e.target.value }))} aria-label="Persona"><option value="">Todas las personas</option>{personas.map(p => <option key={p.email} value={p.email}>{p.nombre}</option>)}</select>
            <select value={filtro.estado} onChange={e => setFiltro(f => ({ ...f, estado: e.target.value }))} aria-label="Estado"><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="aprobada">Aprobadas</option><option value="rechazada">Rechazadas</option><option value="cancelada">Canceladas</option></select>
            <select value={filtro.motivo} onChange={e => setFiltro(f => ({ ...f, motivo: e.target.value }))} aria-label="Motivo"><option value="">Todos los motivos</option>{motivos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          </div>
          <ListaSolicitudes lista={todas} motivosPorId={motivosPorId} nombres={nombres} mostrarPersona puedeCancelar={a => ['pendiente', 'aprobada'].includes(a.estado)} alCancelar={cancelar} />
        </>
      )}

      {vista === 'saldos' && <Saldos personas={personas} motivos={motivos} datos={datos} nombres={nombres} yo={yo} alCambiar={cargar} />}
      {vista === 'motivos' && <Motivos motivos={motivos} alCambiar={recargarMotivos} />}

      {registrar && <FormAusencia motivos={motivos} email={yo} personas={personas} asignaciones={datos.asignaciones} ausencias={datos.ausencias} onCancelar={() => setRegistrar(false)} onListo={() => { setRegistrar(false); cargar() }} />}
    </>
  )
}
