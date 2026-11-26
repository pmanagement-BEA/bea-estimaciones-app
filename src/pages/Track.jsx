import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/Toast'
import { diaIso, hhmm, aInstante, lunesDe, sumarDias, textoDia, textoDiaLargo } from '../lib/checador'
import { mesIso, sumarMeses, textoMes } from '../lib/proyecciones'
import {
  H, cargarProyectos, cargarActividades, cargarConceptos, cargarRegistros, cargarHistorico, cronometroActivo,
  duracionMs, diaDe, textoH, horas, num, reloj, esIndirecto, leerDuracion,
} from '../lib/track'

function useAhora(ms = 1000) {
  const [t, setT] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i) }, [ms])
  return t
}

const sinAcentos = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ── Buscador de proyecto (escribe clave, nombre o cliente) ──
function BuscadorProyecto({ proyectos, valor, alElegir, placeholder = 'Proyecto (clave, nombre o cliente)…' }) {
  const [txt, setTxt] = useState('')
  const [abierto, setAbierto] = useState(false)
  const elegido = proyectos.find(p => p.id === valor)
  const lista = useMemo(() => {
    const q = sinAcentos(txt)
    const activos = proyectos.filter(p => p.activo)
    if (!q) return activos.slice(0, 40)
    return activos.filter(p => sinAcentos(`${p.nombre} ${p.cliente}`).includes(q)).slice(0, 40)
  }, [txt, proyectos])
  return (
    <div className="buscador-trk">
      <input
        value={abierto ? txt : (elegido?.nombre || '')}
        placeholder={placeholder}
        onFocus={() => { setAbierto(true); setTxt('') }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={e => setTxt(e.target.value)}
        aria-label="Proyecto"
      />
      {abierto && (
        <ul className="opciones-trk" role="listbox">
          {lista.length === 0 && <li className="vacio">Sin coincidencias</li>}
          {lista.map(p => (
            <li key={p.id} role="option" aria-selected={p.id === valor} onMouseDown={() => { alElegir(p); setAbierto(false) }}>
              <span className="nom">{p.nombre}</span><span className="cli">{p.cliente}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Actividades de Toggl del proyecto + conceptos de su estimación (si está ligado a la app). */
function useOpciones(proyecto) {
  const [ops, setOps] = useState({ actividades: [], conceptos: [] })
  useEffect(() => {
    if (!proyecto) { setOps({ actividades: [], conceptos: [] }); return }
    let vivo = true
    Promise.all([cargarActividades(proyecto.id), cargarConceptos(proyecto.project_id)])
      .then(([a, c]) => vivo && setOps({ actividades: a.filter(x => x.activo), conceptos: c }))
      .catch(() => vivo && setOps({ actividades: [], conceptos: [] }))
    return () => { vivo = false }
  }, [proyecto?.id])
  return ops
}

function SelectorActividad({ ops, valor, alCambiar }) {
  return (
    <select value={valor} onChange={e => alCambiar(e.target.value)} aria-label="Actividad">
      <option value="">— Actividad (opcional) —</option>
      {ops.conceptos.length > 0 && (
        <optgroup label="Conceptos de la estimación">
          {ops.conceptos.map(c => <option key={c.id} value={`c:${c.id}`}>{c.key} {c.description}</option>)}
        </optgroup>
      )}
      {ops.actividades.length > 0 && (
        <optgroup label="Actividades (Toggl)">
          {ops.actividades.map(a => <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>)}
        </optgroup>
      )}
    </select>
  )
}
const partir = v => ({ actividad_id: v?.startsWith('a:') ? +v.slice(2) : null, concepto_id: v?.startsWith('c:') ? v.slice(2) : null })
const juntar = r => (r.concepto_id ? `c:${r.concepto_id}` : r.actividad_id ? `a:${r.actividad_id}` : '')

// ── Registrar ──
function Registrar({ email, proyectos, porId }) {
  const ahora = useAhora(1000)
  const [activo, setActivo] = useState(undefined)
  const [desc, setDesc] = useState('')
  const [proy, setProy] = useState(null)
  const [act, setAct] = useState('')
  const [fact, setFact] = useState(true)
  const [manual, setManual] = useState(false)
  const [m, setM] = useState({ fecha: diaIso(), desde: '09:00', hasta: '10:00', dur: '' })
  const [recientes, setRecientes] = useState(null)
  const [editando, setEditando] = useState(null)
  const ops = useOpciones(proy)

  async function cargar() {
    const hoy = diaIso()
    const [a, r] = await Promise.all([cronometroActivo(email), cargarRegistros({ desde: sumarDias(hoy, -13), hasta: hoy, email })])
    setActivo(a); setRecientes(r)
    if (a) { setDesc(a.descripcion); setProy(porId[a.proyecto_id] || null); setAct(juntar(a)); setFact(a.facturable) }
  }
  useEffect(() => { if (email && proyectos.length) cargar().catch(e => toast('No se pudo cargar: ' + e.message, true)) }, [email, proyectos.length])

  function elegirProyecto(p) { setProy(p); setAct(''); setFact(p.facturable && !esIndirecto(p)) }

  async function iniciar(base) {
    const datos = base || { proyecto_id: proy?.id, descripcion: desc.trim(), facturable: fact, ...partir(act) }
    if (!datos.proyecto_id) { toast('Elige un proyecto', true); return }
    if (activo) await detener(true)
    const { data, error } = await supabase.from('track_registros').insert({ ...datos, inicio: new Date().toISOString() }).select().single()
    if (error) { toast('No se pudo iniciar: ' + error.message, true); return }
    setActivo(data)
    if (base) { setDesc(base.descripcion); setProy(porId[base.proyecto_id] || null); setAct(juntar(base)); setFact(base.facturable) }
    cargar()
  }
  async function detener(silencioso) {
    if (!activo) return
    const fin = new Date(Math.max(Date.now(), new Date(activo.inicio).getTime() + 1000)).toISOString()
    const { error } = await supabase.from('track_registros').update({ fin, descripcion: desc.trim(), proyecto_id: proy?.id || activo.proyecto_id, facturable: fact, ...partir(act), updated_at: new Date().toISOString() }).eq('id', activo.id)
    if (error) { toast('No se pudo detener: ' + error.message, true); return }
    setActivo(null)
    if (!silencioso) { toast(`Registrado ✓ ${textoH(duracionMs({ inicio: activo.inicio, fin }))}`); setDesc(''); cargar() }
  }
  async function guardarManual() {
    if (!proy) { toast('Elige un proyecto', true); return }
    let inicio, fin
    if (m.dur) {
      const ms = leerDuracion(m.dur)
      if (!ms) { toast('Duración no válida (ej. 1:30 o 1.5)', true); return }
      inicio = aInstante(m.fecha, m.desde || '09:00'); fin = new Date(new Date(inicio).getTime() + ms).toISOString()
    } else {
      inicio = aInstante(m.fecha, m.desde); fin = aInstante(m.fecha, m.hasta)
      if (fin <= inicio) { toast('La hora final debe ser después de la inicial', true); return }
    }
    const { error } = await supabase.from('track_registros').insert({ proyecto_id: proy.id, descripcion: desc.trim(), facturable: fact, inicio, fin, ...partir(act) })
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    toast('Tiempo agregado ✓'); setDesc(''); setM(x => ({ ...x, dur: '' })); cargar()
  }
  async function borrar(r) {
    if (!window.confirm(`¿Borrar "${r.descripcion || 'sin descripción'}" (${textoH(duracionMs(r))})?`)) return
    const { error } = await supabase.from('track_registros').delete().eq('id', r.id)
    if (error) { toast('No se pudo borrar: ' + error.message, true); return }
    cargar()
  }

  const porDia = useMemo(() => {
    const g = {}
    ;(recientes || []).filter(r => r.fin).forEach(r => { (g[diaDe(r)] ||= []).push(r) })
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]))
  }, [recientes])

  if (activo === undefined) return <div className="vacio-chk">Cargando…</div>
  const corriendo = !!activo
  return (
    <>
      <div className={`timer-trk${corriendo ? ' corriendo' : ''}`}>
        <input className="desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="¿En qué estás trabajando?" aria-label="Descripción"
          onKeyDown={e => e.key === 'Enter' && !manual && (corriendo ? detener() : iniciar())} />
        <BuscadorProyecto proyectos={proyectos} valor={proy?.id} alElegir={elegirProyecto} />
        <SelectorActividad ops={ops} valor={act} alCambiar={setAct} />
        <label className="fact" title="Facturable"><input type="checkbox" checked={fact} onChange={e => setFact(e.target.checked)} /> $</label>
        {!manual && <div className="crono">{corriendo ? reloj(duracionMs(activo, ahora)) : '00:00:00'}</div>}
        {!manual && (corriendo
          ? <button className="btn btn-danger" onClick={() => detener()}>■ Detener</button>
          : <button className="btn btn-primary" onClick={() => iniciar()}>▶ Iniciar</button>)}
        <button className="btn btn-ghost btn-sm" onClick={() => setManual(v => !v)} disabled={corriendo} title="Capturar a mano">{manual ? '⏱ Cronómetro' : '✎ Manual'}</button>
      </div>
      {manual && (
        <div className="manual-trk">
          <input type="date" value={m.fecha} onChange={e => setM(x => ({ ...x, fecha: e.target.value }))} aria-label="Fecha" />
          <input type="time" value={m.desde} onChange={e => setM(x => ({ ...x, desde: e.target.value }))} aria-label="Desde" />
          <span>a</span>
          <input type="time" value={m.hasta} disabled={!!m.dur} onChange={e => setM(x => ({ ...x, hasta: e.target.value }))} aria-label="Hasta" />
          <span>o</span>
          <input className="dur" value={m.dur} onChange={e => setM(x => ({ ...x, dur: e.target.value }))} placeholder="duración (1:30)" aria-label="Duración" />
          <button className="btn btn-primary btn-sm" onClick={guardarManual}>＋ Agregar</button>
        </div>
      )}
      {corriendo && <p className="ayuda" style={{ margin: '6px 0 0' }}>Corriendo desde las {hhmm(activo.inicio)} · {porId[activo.proyecto_id]?.nombre}</p>}

      <div className="section-header" style={{ marginTop: 22 }}><span className="section-title">Últimos 14 días</span></div>
      {porDia.length === 0 && <div className="vacio-chk">Todavía no tienes tiempo registrado aquí. Elige un proyecto y dale ▶ Iniciar.</div>}
      {porDia.map(([dia, rs]) => (
        <div key={dia} className="dia-trk">
          <div className="cab"><span>{textoDiaLargo(dia)}</span><strong>{textoH(rs.reduce((s, r) => s + duracionMs(r), 0))}</strong></div>
          {rs.map(r => editando === r.id
            ? <EditarRegistro key={r.id} r={r} proyectos={proyectos} porId={porId} alTerminar={() => { setEditando(null); cargar() }} />
            : (
              <div key={r.id} className="reg-trk">
                <span className="d">{r.descripcion || <em>sin descripción</em>}</span>
                <span className="p" title={porId[r.proyecto_id]?.nombre}>{porId[r.proyecto_id]?.nombre || '—'}</span>
                <span className="f">{r.facturable ? '$' : ''}</span>
                <span className="h">{hhmm(r.inicio)}–{hhmm(r.fin)}</span>
                <strong className="t">{textoH(duracionMs(r))}</strong>
                <span className="acc">
                  <button className="btn-link-mini" title="Seguir con esto" onClick={() => iniciar({ proyecto_id: r.proyecto_id, actividad_id: r.actividad_id, concepto_id: r.concepto_id, descripcion: r.descripcion, facturable: r.facturable })}>▶</button>
                  <button className="btn-link-mini" onClick={() => setEditando(r.id)}>Editar</button>
                  <button className="btn-link-mini rojo" onClick={() => borrar(r)}>✕</button>
                </span>
              </div>
            ))}
        </div>
      ))}
    </>
  )
}

function EditarRegistro({ r, proyectos, porId, alTerminar }) {
  const [desc, setDesc] = useState(r.descripcion)
  const [proy, setProy] = useState(porId[r.proyecto_id] || null)
  const [act, setAct] = useState(juntar(r))
  const [fecha, setFecha] = useState(diaDe(r))
  const [desde, setDesde] = useState(hhmm(r.inicio))
  const [hasta, setHasta] = useState(hhmm(r.fin))
  const [fact, setFact] = useState(r.facturable)
  const ops = useOpciones(proy)
  async function guardar() {
    const inicio = aInstante(fecha, desde), fin = aInstante(fecha, hasta)
    if (fin <= inicio) { toast('La hora final debe ser después de la inicial', true); return }
    const { error } = await supabase.from('track_registros').update({ descripcion: desc.trim(), proyecto_id: proy?.id || r.proyecto_id, ...partir(act), inicio, fin, facturable: fact, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    alTerminar()
  }
  return (
    <div className="reg-trk editando">
      <input value={desc} onChange={e => setDesc(e.target.value)} aria-label="Descripción" />
      <BuscadorProyecto proyectos={proyectos} valor={proy?.id} alElegir={p => { setProy(p); setAct('') }} />
      <SelectorActividad ops={ops} valor={act} alCambiar={setAct} />
      <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} aria-label="Fecha" />
      <input type="time" value={desde} onChange={e => setDesde(e.target.value)} aria-label="Desde" />
      <input type="time" value={hasta} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
      <label className="fact"><input type="checkbox" checked={fact} onChange={e => setFact(e.target.checked)} /> $</label>
      <button className="btn btn-primary btn-sm" onClick={guardar}>Guardar</button>
      <button className="btn btn-ghost btn-sm" onClick={alTerminar}>Cancelar</button>
    </div>
  )
}

// ── Mi semana ──
function MiSemana({ email, porId }) {
  const [lunes, setLunes] = useState(lunesDe(diaIso()))
  const [rs, setRs] = useState(null)
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
  useEffect(() => { setRs(null); cargarRegistros({ desde: lunes, hasta: sumarDias(lunes, 6), email }).then(setRs).catch(e => { toast(e.message, true); setRs([]) }) }, [lunes, email])
  const filas = useMemo(() => {
    const g = {}
    ;(rs || []).forEach(r => { const k = r.proyecto_id; g[k] ||= { k, dias: {}, total: 0 }; const d = diaDe(r), ms = duracionMs(r); g[k].dias[d] = (g[k].dias[d] || 0) + ms; g[k].total += ms })
    return Object.values(g).sort((a, b) => b.total - a.total)
  }, [rs])
  const totDia = d => filas.reduce((s, f) => s + (f.dias[d] || 0), 0)
  const total = filas.reduce((s, f) => s + f.total, 0)
  return (
    <>
      <div className="selector-mes">
        <button className="btn btn-sm btn-outline" onClick={() => setLunes(sumarDias(lunes, -7))}>‹</button>
        <strong>Semana del {textoDia(lunes)} al {textoDia(sumarDias(lunes, 6))}</strong>
        <button className="btn btn-sm btn-outline" onClick={() => setLunes(sumarDias(lunes, 7))} disabled={lunes >= lunesDe(diaIso())}>›</button>
        <span className="ayuda">Total {textoH(total)} · {Math.round((total / (40 * H)) * 100)}% de 40 h</span>
      </div>
      {!rs ? <div className="vacio-chk">Cargando…</div> : (
        <div className="tabla-chk-wrap">
          <table className="tabla-chk tabla-trk">
            <thead><tr><th>Proyecto</th>{dias.map(d => <th key={d} className="num">{textoDia(d)}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={9} className="vacio-chk">Sin tiempo registrado esta semana.</td></tr>}
              {filas.map(f => (
                <tr key={f.k}><td className="pn">{porId[f.k]?.nombre || f.k}</td>{dias.map(d => <td key={d} className="num">{f.dias[d] ? horas(f.dias[d]) : ''}</td>)}<td className="num"><strong>{horas(f.total)}</strong></td></tr>
              ))}
            </tbody>
            {filas.length > 0 && <tfoot><tr><td>Total</td>{dias.map(d => <td key={d} className="num">{totDia(d) ? horas(totDia(d)) : ''}</td>)}<td className="num"><strong>{horas(total)}</strong></td></tr></tfoot>}
          </table>
        </div>
      )}
    </>
  )
}

// ── Reportes (histórico de Toggl + lo registrado aquí) ──
function Reportes({ email, verTodo, porId, gente }) {
  const hoy = mesIso(new Date())
  const [desde, setDesde] = useState(sumarMeses(hoy, -5))
  const [hasta, setHasta] = useState(hoy)
  const [persona, setPersona] = useState(verTodo ? '' : email)
  const [area, setArea] = useState('')
  const [vista, setVista] = useState('proyectos')
  const [filas, setFilas] = useState(null)
  const areaDe = useMemo(() => Object.fromEntries(gente.map(g => [g.email, g.area || 'Sin área'])), [gente])
  const nombreDe = useMemo(() => Object.fromEntries(gente.map(g => [g.email, g.nombre])), [gente])
  const meses = []; for (let m = desde; m <= hasta && meses.length < 60; m = sumarMeses(m, 1)) meses.push(m)

  useEffect(() => {
    setFilas(null)
    const fin = new Date(+hasta.slice(0, 4), +hasta.slice(5, 7), 0)
    Promise.all([
      cargarHistorico({ mesDesde: desde, mesHasta: hasta }),
      cargarRegistros({ desde: `${desde}-01`, hasta: `${hasta}-${String(fin.getDate()).padStart(2, '0')}` }),
    ]).then(([hist, regs]) => {
      const out = hist.map(h => ({ mes: h.mes, proyecto_id: h.proyecto_id, email: h.email, nombre: h.nombre, ms: h.segundos * 1000, fuente: 'toggl' }))
      regs.forEach(r => out.push({ mes: diaDe(r).slice(0, 7), proyecto_id: r.proyecto_id, email: r.email, nombre: '', ms: duracionMs(r), fuente: 'app', facturable: r.facturable }))
      setFilas(out)
    }).catch(e => { toast('No se pudo cargar: ' + e.message, true); setFilas([]) })
  }, [desde, hasta])

  const datos = useMemo(() => (filas || []).filter(f => (!persona || f.email === persona) && (!area || (areaDe[f.email] || 'Sin área') === area)), [filas, persona, area, areaDe])
  const total = datos.reduce((s, f) => s + f.ms, 0)
  const fact = datos.reduce((s, f) => s + ((f.facturable ?? (porId[f.proyecto_id]?.facturable && !esIndirecto(porId[f.proyecto_id]))) ? f.ms : 0), 0)
  const indirectas = datos.reduce((s, f) => s + (esIndirecto(porId[f.proyecto_id]) ? f.ms : 0), 0)
  const personas = new Set(datos.map(f => f.email).filter(Boolean))
  const proyectosSet = new Set(datos.map(f => f.proyecto_id))

  const agrupar = clave => {
    const g = {}
    datos.forEach(f => { const k = clave(f); g[k] ||= { k, ms: 0, personas: new Set(), proyectos: new Set(), meses: {} }; g[k].ms += f.ms; f.email && g[k].personas.add(f.email); g[k].proyectos.add(f.proyecto_id); g[k].meses[f.mes] = (g[k].meses[f.mes] || 0) + f.ms })
    return Object.values(g).sort((a, b) => b.ms - a.ms)
  }
  const porMes = meses.map(m => ({ m, ms: datos.filter(f => f.mes === m).reduce((s, f) => s + f.ms, 0) }))
  const maxMes = Math.max(1, ...porMes.map(x => x.ms))
  const nombrePersona = e => nombreDe[e] || (filas || []).find(f => f.email === e && f.nombre)?.nombre || e || '(sin persona)'
  const areas = [...new Set(gente.map(g => g.area || 'Sin área'))].sort()

  let tabla = null
  if (vista === 'proyectos') {
    const g = agrupar(f => f.proyecto_id)
    tabla = (
      <table className="tabla-chk tabla-trk">
        <thead><tr><th>Proyecto</th><th>Cliente</th><th className="num">Horas</th><th className="num">%</th><th className="num">Personas</th><th className="num">Acumulado Toggl</th><th className="num">Estimadas</th></tr></thead>
        <tbody>{g.slice(0, 300).map(x => { const p = porId[x.k]; const exc = p?.horas_estimadas && p.horas_toggl > p.horas_estimadas; return (
          <tr key={x.k}><td className="pn">{p?.nombre || x.k}{esIndirecto(p) && <span className="chip-trk">indirecto</span>}</td><td>{p?.cliente}</td><td className="num"><strong>{horas(x.ms)}</strong></td><td className="num">{total ? Math.round((x.ms / total) * 1000) / 10 : 0}%</td><td className="num">{x.personas.size}</td>
            <td className="num">{p ? num(p.horas_toggl) + ' h' : ''}</td><td className={`num${exc ? ' exc' : ''}`}>{p?.horas_estimadas ? num(p.horas_estimadas) + ' h' : '—'}{exc && <span title="Ya se pasó de las horas estimadas"> ⚠</span>}</td></tr>) })}</tbody>
      </table>
    )
  } else if (vista === 'personas') {
    const g = agrupar(f => f.email)
    tabla = (
      <table className="tabla-chk tabla-trk">
        <thead><tr><th>Persona</th><th>Área</th><th className="num">Horas</th><th className="num">Prom. mensual</th><th className="num">Proyectos</th>{meses.slice(-6).map(m => <th key={m} className="num">{textoMes(m).slice(0, 3)} {m.slice(2, 4)}</th>)}</tr></thead>
        <tbody>{g.map(x => (
          <tr key={x.k}><td className="pn">{nombrePersona(x.k)}</td><td>{areaDe[x.k] || 'Sin área'}</td><td className="num"><strong>{horas(x.ms)}</strong></td><td className="num">{horas(x.ms / meses.length)}</td><td className="num">{x.proyectos.size}</td>{meses.slice(-6).map(m => <td key={m} className="num">{x.meses[m] ? horas(x.meses[m], 0) : ''}</td>)}</tr>
        ))}</tbody>
      </table>
    )
  } else {
    const g = agrupar(f => areaDe[f.email] || 'Sin área')
    tabla = (
      <table className="tabla-chk tabla-trk">
        <thead><tr><th>Área</th><th className="num">Horas</th><th className="num">%</th><th className="num">Personas</th><th className="num">Proyectos</th></tr></thead>
        <tbody>{g.map(x => (
          <tr key={x.k}><td className="pn">{x.k}</td><td className="num"><strong>{horas(x.ms)}</strong></td><td className="num">{total ? Math.round((x.ms / total) * 1000) / 10 : 0}%</td><td className="num">{x.personas.size}</td><td className="num">{x.proyectos.size}</td></tr>
        ))}</tbody>
      </table>
    )
  }

  const opcMes = Array.from({ length: 36 }, (_, i) => sumarMeses(hoy, -i))
  return (
    <>
      <div className="filtros-trk">
        <label>De <select value={desde} onChange={e => setDesde(e.target.value)}>{opcMes.map(m => <option key={m} value={m}>{textoMes(m)}</option>)}</select></label>
        <label>a <select value={hasta} onChange={e => setHasta(e.target.value)}>{opcMes.map(m => <option key={m} value={m}>{textoMes(m)}</option>)}</select></label>
        {verTodo && <label>Persona <select value={persona} onChange={e => setPersona(e.target.value)}><option value="">Todas</option>{gente.filter(g => g.activo !== false).map(g => <option key={g.email} value={g.email}>{g.nombre || g.email}</option>)}</select></label>}
        {verTodo && <label>Área <select value={area} onChange={e => setArea(e.target.value)}><option value="">Todas</option>{areas.map(a => <option key={a}>{a}</option>)}</select></label>}
      </div>
      {!filas ? <div className="vacio-chk">Cargando…</div> : (
        <>
          <div className="kpis-trk">
            <div className="resumen-chk"><div className="titulo">Horas</div><div className="valor">{num(total / H)}</div><div className="pie"><span>{meses.length} {meses.length === 1 ? 'mes' : 'meses'}</span><span>{num(total / H / meses.length)} h/mes</span></div></div>
            <div className="resumen-chk"><div className="titulo">Facturables</div><div className="valor">{total ? Math.round((fact / total) * 100) : 0}%</div><div className="pie"><span>{num(fact / H)} h</span></div></div>
            <div className="resumen-chk"><div className="titulo">Horas indirectas</div><div className="valor">{total ? Math.round((indirectas / total) * 100) : 0}%</div><div className="pie"><span>BEA, PMO, calidad, IA…</span></div></div>
            <div className="resumen-chk"><div className="titulo">Proyectos · personas</div><div className="valor">{proyectosSet.size} · {personas.size}</div><div className="pie"><span>{personas.size ? num(total / H / personas.size / meses.length) : 0} h/persona/mes</span></div></div>
          </div>
          <div className="barras-trk" aria-label="Horas por mes">
            {porMes.map(x => (
              <div key={x.m} className="col" title={`${textoMes(x.m)}: ${horas(x.ms)}`}>
                <span className="v">{num(x.ms / H)}</span>
                <span className="b" style={{ height: `${(x.ms / maxMes) * 100}%` }} />
                <span className="m">{textoMes(x.m).slice(0, 3)} {x.m.slice(2, 4)}</span>
              </div>
            ))}
          </div>
          <div className="subpestanas-rh" style={{ margin: '14px 0 8px' }}>
            {[['proyectos', 'Por proyecto'], ['personas', 'Por persona'], ['areas', 'Por área']].map(([k, t]) => <button key={k} className={vista === k ? 'activa' : ''} onClick={() => setVista(k)}>{t}</button>)}
          </div>
          <div className="tabla-chk-wrap">{tabla}</div>
          <p className="ayuda" style={{ marginTop: 8 }}>Hasta el 26 nov 2026 las horas vienen de Toggl (histórico mensual); de ahí en adelante, de lo que se registre aquí.</p>
        </>
      )}
    </>
  )
}

// ── Proyectos (catálogo con estimado contra real) ──
function Catalogo({ proyectos }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [soloActivos, setSoloActivos] = useState(true)
  const [orden, setOrden] = useState('horas')
  const [abierto, setAbierto] = useState(null)
  const [acts, setActs] = useState({})
  const lista = useMemo(() => {
    const s = sinAcentos(q)
    return proyectos
      .filter(p => (!soloActivos || p.activo) && (!s || sinAcentos(`${p.nombre} ${p.cliente}`).includes(s)))
      .sort((a, b) => orden === 'nombre' ? a.nombre.localeCompare(b.nombre) : orden === 'exceso' ? ((b.horas_toggl / (b.horas_estimadas || Infinity)) - (a.horas_toggl / (a.horas_estimadas || Infinity))) : b.horas_toggl - a.horas_toggl)
  }, [proyectos, q, soloActivos, orden])
  async function abrir(p) {
    if (abierto === p.id) { setAbierto(null); return }
    setAbierto(p.id)
    if (!acts[p.id]) { const a = await cargarActividades(p.id).catch(() => []); setActs(x => ({ ...x, [p.id]: a })) }
  }
  const conEst = lista.filter(p => p.horas_estimadas)
  const excedidos = conEst.filter(p => p.horas_toggl > p.horas_estimadas)
  return (
    <>
      <div className="filtros-trk">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar proyecto o cliente…" aria-label="Buscar" />
        <label><input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} /> Solo activos</label>
        <label>Ordenar <select value={orden} onChange={e => setOrden(e.target.value)}><option value="horas">Más horas</option><option value="exceso">% de horas estimadas usadas</option><option value="nombre">Nombre</option></select></label>
        <span className="ayuda">{lista.length} proyectos · {conEst.length} con horas estimadas · <strong className="exc">{excedidos.length} ya rebasaron lo estimado</strong></span>
      </div>
      <div className="tabla-chk-wrap">
        <table className="tabla-chk tabla-trk">
          <thead><tr><th>Proyecto</th><th>Cliente</th><th className="num">Horas Toggl</th><th className="num">Estimadas</th><th style={{ width: 160 }}>Consumo</th><th>En la app</th></tr></thead>
          <tbody>
            {lista.slice(0, 400).map(p => {
              const pct = p.horas_estimadas ? (p.horas_toggl / p.horas_estimadas) * 100 : null
              return [
                <tr key={p.id} onClick={() => abrir(p)} className="clic">
                  <td className="pn">{abierto === p.id ? '▾' : '▸'} {p.nombre}{!p.activo && <span className="chip-trk">archivado</span>}</td>
                  <td>{p.cliente}</td>
                  <td className="num"><strong>{num(p.horas_toggl)} h</strong></td>
                  <td className="num">{p.horas_estimadas ? num(p.horas_estimadas) + ' h' : '—'}</td>
                  <td>{pct != null && <div className={`consumo-trk${pct > 100 ? ' exc' : pct > 85 ? ' alerta' : ''}`}><span style={{ width: `${Math.min(100, pct)}%` }} /><b>{Math.round(pct)}%</b></div>}</td>
                  <td>{p.project_id ? <button className="btn-link-mini" onClick={e => { e.stopPropagation(); navigate(`/projects/${p.project_id}/history`) }}>Ver estimaciones</button> : ''}</td>
                </tr>,
                abierto === p.id && (
                  <tr key={p.id + 'a'} className="sub"><td colSpan={6}>
                    {!acts[p.id] ? 'Cargando…' : acts[p.id].length === 0 ? 'Sin actividades en Toggl.' : (
                      <ul className="acts-trk">{[...acts[p.id]].sort((a, b) => b.horas_toggl - a.horas_toggl).map(a => (
                        <li key={a.id} className={a.activo ? '' : 'inactiva'}><span>{a.nombre}</span><b>{num(a.horas_toggl, 1)} h{a.horas_estimadas ? ` / ${num(a.horas_estimadas, 1)} h` : ''}</b></li>
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

export default function Track() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const email = (profile?.email || '').toLowerCase()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'registrar'
  const setTab = t => setParams(t === 'registrar' ? {} : { tab: t }, { replace: true })
  const [proyectos, setProyectos] = useState(null)
  const [gente, setGente] = useState([])
  const [verTodo, setVerTodo] = useState(false)

  useEffect(() => {
    cargarProyectos().then(setProyectos).catch(e => { toast('No se pudieron cargar los proyectos: ' + e.message, true); setProyectos([]) })
    supabase.from('directorio').select('email, nombre, area, activo').then(({ data }) => setGente(data || []))
  }, [])
  useEffect(() => { if (email) supabase.rpc('ve_todo_track').then(({ data }) => setVerTodo(!!data)) }, [email])
  const porId = useMemo(() => Object.fromEntries((proyectos || []).map(p => [p.id, p])), [proyectos])

  const pestanas = [
    ['registrar', 'Registrar', 'cronómetro y captura'],
    ['semana', 'Mi semana', 'horas por proyecto y día'],
    ['reportes', 'Reportes', verTodo ? 'equipo, proyectos y áreas' : 'mis horas'],
    ['proyectos', 'Proyectos', 'estimado contra real'],
  ]
  let contenido = <div className="vacio-chk">Cargando…</div>
  if (proyectos && email) {
    if (tab === 'semana') contenido = <MiSemana email={email} porId={porId} />
    else if (tab === 'reportes') contenido = <Reportes email={email} verTodo={verTodo} porId={porId} gente={gente} />
    else if (tab === 'proyectos') contenido = <Catalogo proyectos={proyectos} />
    else contenido = <Registrar email={email} proyectos={proyectos} porId={porId} />
  }
  return (
    <div className="main">
      <div className="breadcrumb"><a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span><span className="current">Track</span></div>
      <h1 className="page-title">Track <span className="chip-trk beta">beta</span></h1>
      <div className="pestanas-proy" role="tablist">
        {pestanas.map(([k, t, d]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'activa' : ''} onClick={() => setTab(k)}><div className="t-pest">{t}</div><span>{d}</span></button>)}
      </div>
      {contenido}
    </div>
  )
}
