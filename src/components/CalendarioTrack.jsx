import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'
import { diaIso, hhmm, aInstante, lunesDe, sumarDias, cargarChecadas } from '../lib/checador'
import { cargarRegistros, duracionMs, diaDe, textoH, H } from '../lib/track'
import { BuscadorProyecto, useOpciones, SelectorActividad, juntar, resolverActividad } from './TrackCampos'
import AccionesConceptoTrack from './AccionesConceptoTrack'

// Colores por proyecto (estables: dependen del id)
const PALETA = ['#7C3AED', '#C026D3', '#DB2777', '#E11D48', '#EA580C', '#D97706', '#65A30D', '#16A34A', '#0D9488', '#0891B2', '#0284C7', '#2563EB', '#4F46E5', '#9333EA', '#B45309', '#047857']
export const colorDe = id => PALETA[Math.abs(Number(id || 0)) % PALETA.length]
/** Color de un bloque: por concepto o actividad (si no tiene, por descripción y luego por proyecto). */
export function colorBloque(r) {
  const k = r.concepto_id || (r.actividad_id && `a${r.actividad_id}`) || (r.descripcion || '').trim().toLowerCase() || `p${r.proyecto_id}`
  let h = 0; for (const ch of String(k)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return PALETA[Math.abs(h) % PALETA.length]
}

const ZOOMS = [36, 48, 64, 96]          // px por hora
const PASO = 15                          // minutos para ajustar al arrastrar
const DIAS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
const dos = n => String(n).padStart(2, '0')
const aHM = min => `${dos(Math.floor(min / 60))}:${dos(min % 60)}`
const minDe = iso => { const [h, m] = hhmm(iso).split(':').map(Number); return h * 60 + m }
const ajustar = min => Math.max(0, Math.min(1440, Math.round(min / PASO) * PASO))
const semanaIso = lunes => { const d = new Date(lunes + 'T12:00:00'); d.setDate(d.getDate() + 3); const a = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - a) / 86400000 - 3 + ((a.getDay() + 6) % 7)) / 7) }
const hText = ms => { const t = Math.round(ms / 60000); return `${Math.floor(t / 60)}:${dos(t % 60)}` }

/** Reparte los bloques de un día en carriles cuando se enciman. */
function carriles(bloques) {
  const orden = [...bloques].sort((a, b) => a.ini - b.ini || b.fin - a.fin)
  const out = []
  let grupo = [], finGrupo = -1
  const cerrar = () => { const n = Math.max(1, ...grupo.map(b => b.carril + 1)); grupo.forEach(b => out.push({ ...b, carriles: n })); grupo = [] }
  for (const b of orden) {
    if (grupo.length && b.ini >= finGrupo) cerrar()
    const usados = new Set(grupo.filter(g => g.fin > b.ini).map(g => g.carril))
    let c = 0; while (usados.has(c)) c++
    grupo.push({ ...b, carril: c }); finGrupo = Math.max(finGrupo, b.fin)
  }
  if (grupo.length) cerrar()
  return out
}

/** Ventana para crear o editar un registro. */
function FormRegistro({ datos, proyectos, porId, alCerrar, alGuardar }) {
  const r = datos.registro
  const [desc, setDesc] = useState(r?.descripcion || '')
  const [proy, setProy] = useState(r ? porId[r.proyecto_id] || null : datos.proyecto || null)
  const [act, setAct] = useState(r ? juntar(r) : datos.actividad || '')
  const [fact, setFact] = useState(r ? r.facturable : (datos.proyecto?.facturable ?? true))
  const [fecha, setFecha] = useState(datos.fecha)
  const [desde, setDesde] = useState(datos.desde)
  const [hasta, setHasta] = useState(datos.hasta)
  const ops = useOpciones(proy)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function guardar() {
    if (!proy) { toast('Elige un proyecto', true); return }
    const inicio = aInstante(fecha, desde)
    const fin = hasta === '24:00' ? aInstante(sumarDias(fecha, 1), '00:00') : aInstante(fecha, hasta)
    if (fin <= inicio) { toast('La hora final debe ser después de la inicial', true); return }
    let cols
    try { cols = await resolverActividad(act, proy.id) } catch (e) { toast('No se pudo preparar la actividad: ' + e.message, true); return }
    const fila = { descripcion: desc.trim(), proyecto_id: proy.id, facturable: fact, inicio, fin, ...cols }
    const { error } = r
      ? await supabase.from('track_registros').update({ ...fila, updated_at: new Date().toISOString() }).eq('id', r.id)
      : await supabase.from('track_registros').insert(fila)
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    alGuardar()
  }
  async function borrar() {
    if (!window.confirm('¿Borrar este registro?')) return
    const { error } = await supabase.from('track_registros').delete().eq('id', r.id)
    if (error) { toast('No se pudo borrar: ' + error.message, true); return }
    alGuardar()
  }
  return (
    <div className="modal-overlay show" onMouseDown={e => e.target === e.currentTarget && alCerrar()}>
      <div className="modal form-cal-trk" onKeyDown={e => { if (e.key === 'Escape') alCerrar(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') guardar() }}>
        <div className="modal-title">{r ? 'Editar registro' : 'Nuevo registro'}</div>
        <input ref={ref} className="desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="¿Qué hiciste?" aria-label="Descripción" />
        <BuscadorProyecto proyectos={proyectos} valor={proy?.id} alElegir={p => { setProy(p); setAct(''); setFact(p.facturable) }} />
        <SelectorActividad ops={ops} valor={act} alCambiar={setAct} />
        {act.startsWith('c:') && proy?.project_id && <AccionesConceptoTrack projectId={proy.project_id} conceptId={act.slice(2)} />}
        <div className="horas-cal-trk">
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} aria-label="Fecha" />
          <input type="time" value={desde} onChange={e => setDesde(e.target.value)} aria-label="Desde" />
          <span>a</span>
          <input type="time" value={hasta === '24:00' ? '23:59' : hasta} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
          <label className="fact"><input type="checkbox" checked={fact} onChange={e => setFact(e.target.checked)} /> Facturable</label>
        </div>
        <div className="modal-actions">
          {r && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={borrar}>Borrar</button>}
          <button className="btn btn-outline" onClick={alCerrar}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Calendario semanal como el de Toggl: arrastra en un hueco para registrar tiempo,
 * clic en un bloque para editarlo, arrástralo para moverlo y jala su borde de abajo para cambiar la duración.
 * La franja verde a la izquierda de cada día es lo que se checó en el Checador.
 */
export default function CalendarioTrack({ email, proyectos, porId, version, alCambiar, ultimo }) {
  const [lunes, setLunes] = useState(lunesDe(diaIso()))
  const [regs, setRegs] = useState(null)
  const [checadas, setChecadas] = useState([])
  const [zoom, setZoom] = useState(1)
  const [arrastre, setArrastre] = useState(null)
  const [form, setForm] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const gridRef = useRef(null)
  const scrollRef = useRef(null)
  const pxH = ZOOMS[zoom], pxM = pxH / 60
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
  const hoy = diaIso()

  async function cargar() {
    const hasta = sumarDias(lunes, 6)
    const [r, c] = await Promise.all([
      cargarRegistros({ desde: lunes, hasta, email }),
      cargarChecadas({ desde: lunes, hasta, email }).then(x => x.checadas).catch(() => []),
    ])
    setRegs(r); setChecadas(c)
  }
  useEffect(() => { setRegs(null); cargar().catch(e => { toast('No se pudo cargar: ' + e.message, true); setRegs([]) }) }, [lunes, email, version])
  useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(i) }, [])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * pxH - 8 }, [lunes, pxH])

  // Bloques por día (el que está corriendo se pinta hasta ahora)
  const porDia = useMemo(() => {
    const g = Object.fromEntries(dias.map(d => [d, []]))
    ;(regs || []).forEach(r => {
      const d = diaDe(r); if (!g[d]) return
      const ini = minDe(r.inicio)
      const finMs = r.fin ? new Date(r.fin).getTime() : ahora
      const fin = diaIso(new Date(finMs)) !== d ? 1440 : Math.max(ini + 1, minDe(new Date(finMs).toISOString()))
      g[d].push({ r, ini, fin, corriendo: !r.fin })
    })
    return Object.fromEntries(Object.entries(g).map(([d, bs]) => [d, carriles(bs)]))
  }, [regs, ahora, lunes])
  const totalDia = d => (regs || []).filter(r => diaDe(r) === d).reduce((s, r) => s + duracionMs(r, ahora), 0)
  const totalSemana = (regs || []).reduce((s, r) => s + duracionMs(r, ahora), 0)
  const reparto = useMemo(() => {
    const g = {}; (regs || []).forEach(r => { g[r.proyecto_id] = (g[r.proyecto_id] || 0) + duracionMs(r, ahora) })
    return Object.entries(g).sort((a, b) => b[1] - a[1])
  }, [regs, ahora])

  // ── Arrastres ──
  const minEn = (e) => { const rect = gridRef.current.getBoundingClientRect(); return (e.clientY - rect.top) / pxM }
  const diaEn = (e) => { const cols = [...gridRef.current.querySelectorAll('.col-cal-trk')]; const i = cols.findIndex(c => { const b = c.getBoundingClientRect(); return e.clientX >= b.left && e.clientX < b.right }); return i < 0 ? null : dias[i] }

  function empezarNuevo(e, dia) {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const m = ajustar(Math.floor(minEn(e) / PASO) * PASO)
    const n = { tipo: 'nuevo', dia, ini: m, fin: m + PASO, origen: m }; arrRef.current = n; setArrastre(n)
  }
  function empezarBloque(e, b, dia) {
    if (e.button !== 0 || b.corriendo) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const tipo = e.clientY > rect.bottom - 8 ? 'duracion' : 'mover'
    const n = { tipo, b, dia, diaDestino: dia, ini: b.ini, fin: b.fin, y0: e.clientY, movido: false }; arrRef.current = n; setArrastre(n)
  }
  // El estado del arrastre también vive en un ref: al soltar se calcula la posición final con ese mismo evento
  const arrRef = useRef(null)
  useEffect(() => { arrRef.current = arrastre }, [arrastre])
  function calcular(a, e) {
    if (a.tipo === 'nuevo') { const m = ajustar(minEn(e)); return m >= a.origen ? { ...a, ini: a.origen, fin: Math.max(a.origen + PASO, m) } : { ...a, ini: m, fin: a.origen + PASO } }
    const dMin = Math.round(((e.clientY - a.y0) / pxM) / PASO) * PASO
    const movido = a.movido || Math.abs(e.clientY - a.y0) > 4
    if (a.tipo === 'duracion') return { ...a, movido, fin: Math.max(a.b.ini + PASO, Math.min(1440, a.b.fin + dMin)) }
    const largo = a.b.fin - a.b.ini
    const ini = Math.max(0, Math.min(1440 - largo, a.b.ini + dMin))
    const dd = diaEn(e) || a.diaDestino
    return { ...a, movido: movido || dd !== a.dia, ini, fin: ini + largo, diaDestino: dd }
  }
  const activoArrastre = !!arrastre
  useEffect(() => {
    if (!activoArrastre) return
    const mover = e => { if (!arrRef.current) return; const n = calcular(arrRef.current, e); arrRef.current = n; setArrastre(n) }
    const soltar = async e => {
      if (!arrRef.current) return
      const a = calcular(arrRef.current, e)
      arrRef.current = null
      setArrastre(null)
      if (a.tipo === 'nuevo') {
        setForm({ fecha: a.dia, desde: aHM(a.ini), hasta: a.fin >= 1440 ? '24:00' : aHM(a.fin), proyecto: ultimo?.proyecto || null, actividad: ultimo?.actividad || '' })
        return
      }
      if (!a.movido) { setForm({ registro: a.b.r, fecha: a.dia, desde: aHM(a.b.ini), hasta: a.b.fin >= 1440 ? '24:00' : aHM(a.b.fin) }); return }
      const dia = a.diaDestino || a.dia
      const inicio = aInstante(dia, aHM(a.ini))
      const fin = a.fin >= 1440 ? aInstante(sumarDias(dia, 1), '00:00') : aInstante(dia, aHM(a.fin))
      const { error } = await supabase.from('track_registros').update({ inicio, fin, updated_at: new Date().toISOString() }).eq('id', a.b.r.id)
      if (error) toast('No se pudo mover: ' + error.message, true)
      cargar(); alCambiar?.()
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    return () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar) }
  }, [activoArrastre])

  const semana = semanaIso(lunes)
  const pct = Math.round((totalSemana / (40 * H)) * 100)
  return (
    <div className="cal-trk">
      <div className="barra-cal-trk">
        <div className="nav">
          <button className="btn btn-sm btn-outline" onClick={() => setLunes(sumarDias(lunes, -7))} aria-label="Semana anterior">‹</button>
          <button className="btn btn-sm btn-outline" onClick={() => setLunes(lunesDe(diaIso()))}>{lunes === lunesDe(hoy) ? 'Esta semana' : 'Ir a hoy'} · S{semana}</button>
          <button className="btn btn-sm btn-outline" onClick={() => setLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente">›</button>
        </div>
        <div className="total"><span>TOTAL DE LA SEMANA</span> <strong>{hText(totalSemana)}</strong> <span className="pct">| {pct}%</span></div>
        <div className="zoom">
          <button className="btn btn-sm btn-ghost" disabled={zoom === 0} onClick={() => setZoom(z => z - 1)} aria-label="Alejar">−</button>
          <button className="btn btn-sm btn-ghost" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(z => z + 1)} aria-label="Acercar">＋</button>
        </div>
      </div>
      {reparto.length > 0 && (
        <div className="reparto-cal-trk">
          {reparto.map(([pid, ms]) => (
            <div key={pid} style={{ flexGrow: ms, '--c': colorDe(pid) }} title={`${porId[pid]?.nombre}: ${textoH(ms)}`}>
              <span>{porId[pid]?.nombre || pid}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cab-cal-trk">
        <div className="gutter" />
        {dias.map((d, i) => (
          <div key={d} className={`dia${d === hoy ? ' hoy' : ''}`}>
            <span className="n">{+d.slice(8)}</span><span className="dn">{DIAS[i]}</span><span className="t">{hText(totalDia(d))}</span>
          </div>
        ))}
      </div>
      <div className="scroll-cal-trk" ref={scrollRef}>
        <div className="grid-cal-trk" ref={gridRef} style={{ height: 24 * pxH, '--px-h': `${pxH}px` }}>
          <div className="gutter">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * pxH }}>{h === 0 ? '' : `${dos(h)}:00`}</span>)}</div>
          {dias.map(d => (
            <div key={d} className={`col-cal-trk${d === hoy ? ' hoy' : ''}`} onPointerDown={e => empezarNuevo(e, d)}>
              {checadas.filter(c => c.fecha === d).map(c => {
                const ini = minDe(c.entrada), fin = c.salida ? minDe(c.salida) : (d === hoy ? minDe(new Date(ahora).toISOString()) : ini)
                return <div key={c.id} className="checada-cal-trk" style={{ top: ini * pxM, height: Math.max(2, (fin - ini) * pxM) }} title={`Checador: ${hhmm(c.entrada)}–${c.salida ? hhmm(c.salida) : 'dentro'}`} />
              })}
              {(porDia[d] || []).map(b => {
                const enArrastre = arrastre && arrastre.b && arrastre.b.r.id === b.r.id
                if (enArrastre && arrastre.diaDestino !== d) return null
                const ini = enArrastre ? arrastre.ini : b.ini, fin = enArrastre ? arrastre.fin : b.fin
                const p = porId[b.r.proyecto_id]
                const alto = (fin - ini) * pxM
                return (
                  <div key={b.r.id} className={`bloque-cal-trk${b.corriendo ? ' corriendo' : ''}${enArrastre ? ' arrastrando' : ''}`}
                    style={{ top: ini * pxM, height: Math.max(14, alto - 2), left: `calc(${(b.carril / b.carriles) * 100}% + 2px)`, width: `calc(${100 / b.carriles}% - 4px)`, '--c': colorBloque(b.r) }}
                    onPointerDown={e => empezarBloque(e, b, d)}
                    title={`${b.r.descripcion || 'sin descripción'}\n${p?.nombre || ''}\n${aHM(ini)}–${aHM(Math.min(fin, 1439))}`}>
                    <div className="d">{b.r.descripcion || <em>sin descripción</em>}</div>
                    {alto > 34 && <div className="p">{p?.nombre}</div>}
                    {alto > 52 && <div className="t">{hText((fin - ini) * 60000)} {b.r.facturable ? '$' : ''}</div>}
                    {!b.corriendo && <div className="asa" />}
                  </div>
                )
              })}
              {arrastre?.tipo === 'nuevo' && arrastre.dia === d && (
                <div className="bloque-cal-trk nuevo" style={{ top: arrastre.ini * pxM, height: (arrastre.fin - arrastre.ini) * pxM - 2 }}>
                  <div className="d">{aHM(arrastre.ini)}–{aHM(Math.min(arrastre.fin, 1439))}</div>
                </div>
              )}
              {d === hoy && <div className="ahora-cal-trk" style={{ top: minDe(new Date(ahora).toISOString()) * pxM }} />}
            </div>
          ))}
        </div>
        {!regs && <div className="cargando-cal-trk">Cargando…</div>}
      </div>
      <p className="ayuda" style={{ marginTop: 6 }}>Arrastra en un hueco para registrar tiempo · clic en un bloque para editarlo · arrástralo para moverlo o jala su borde de abajo para cambiar la duración. La franja verde es lo que checaste en el Checador.</p>
      {form && <FormRegistro datos={form} proyectos={proyectos} porId={porId} alCerrar={() => setForm(null)} alGuardar={() => { setForm(null); cargar(); alCambiar?.() }} />}
    </div>
  )
}
