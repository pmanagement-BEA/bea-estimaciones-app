import { useEffect, useMemo, useState } from 'react'
import ReporteChecador from '../components/ReporteChecador'
import { puedeVerReporteDiario } from '../lib/reporteDiario'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/Toast'
import PanelDiaChecador from '../components/PanelDiaChecador'
import { mesIso, sumarMeses, textoMes } from '../lib/proyecciones'
import {
  ZONA, HORARIO, mayuscula, diaIso, hhmm, hora, textoDia, abierta, textoHoras, resumenDia, resumenPeriodo,
  cargarChecadas, rangoDelMes, lunesDe, sumarDias, setCalendarioBea, nombreDia, esEvento, textoDiaLargo, setMotivosAusencia, motivoAusencia,
} from '../lib/checador'
import MisAusencias from '../components/rh/Ausencias'
import AdminAusencias from '../components/rh/AdminAusencias'
import Anuncios, { anunciosSinVer } from '../components/rh/Anuncios'
import { cargarMotivos } from '../lib/ausencias'

const H = 3600000
const dos = n => String(n).padStart(2, '0')
/** 06:21:05 */
const cronometro = ms => { const t = Math.floor(ms / 1000); return `${dos(Math.floor(t / 3600))}:${dos(Math.floor(t / 60) % 60)}:${dos(t % 60)}` }

/** Se vuelve a pintar cada `ms` (reloj y horas que van corriendo). */
function useAhora(ms = 30000) {
  const [t, setT] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i) }, [ms])
  return t
}

function SelectorMes({ mes, setMes, ayuda }) {
  const hoy = mesIso(new Date())
  const meses = Array.from({ length: 24 }, (_, i) => sumarMeses(hoy, -i))
  return (
    <div className="selector-mes">
      <button className="btn btn-sm btn-outline" disabled={mes <= meses.at(-1)} onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">‹</button>
      <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
        {meses.map(m => <option key={m} value={m}>{textoMes(m)}{m === hoy ? ' (este mes)' : ''}</option>)}
      </select>
      <button className="btn btn-sm btn-outline" disabled={mes >= hoy} onClick={() => setMes(sumarMeses(mes, 1))} aria-label="Mes siguiente">›</button>
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </div>
  )
}

const Dif = ({ ms }) => <span className={`dif ${ms < -60000 ? 'neg' : ms > 60000 ? 'pos' : ''}`}>{textoHoras(ms, true)}</span>

/** Tabla del mes: un renglón por día (hasta hoy). Clic en un día abre su detalle. */
function TablaPresencia({ dias, alAbrir }) {
  if (!dias.length) return <div className="vacio-chk">Este mes todavía no empieza.</div>
  const hoy = diaIso()
  return (
    <div className="tabla-chk-wrap">
      <table className="tabla-chk presencia">
        <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th className="num">Descansos</th><th className="num">Horas</th><th className="num">Diferencia</th><th /></tr></thead>
        <tbody>
          {dias.map(d => {
            const vacio = !d.franjas.length
            return (
              <tr key={d.fecha} className={`${d.fecha === hoy ? 'hoy' : ''} ${d.tipo !== 'laborable' ? 'no-lab' : ''}`} onClick={() => alAbrir(d.fecha)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && alAbrir(d.fecha)}>
                <td className="dia">
                  {textoDia(d.fecha)}
                  {d.fecha === hoy && <span className="chip-hoy">hoy</span>}
                  {d.tipo === 'festivo' && <span className="chip-tipo" title={nombreDia(d.fecha)}>{nombreDia(d.fecha) || 'festivo'}</span>}
                  {esEvento(d.fecha) && <span className="chip-evento">{nombreDia(d.fecha)}</span>}
                  {d.ausencia && <span className="chip-ausencia" style={{ '--c': motivoAusencia(d.ausencia.motivo_id)?.color || '#8B5CF6' }}>{motivoAusencia(d.ausencia.motivo_id)?.nombre || 'Ausencia'}</span>}
                </td>
                <td className="hm">{vacio ? (d.tipo === 'laborable' && d.fecha < hoy && !d.ausencia ? <span className="falta">sin checadas</span> : '—') : hhmm(d.entrada)}</td>
                <td className="hm">{vacio ? '' : d.salida === 'ahora' ? <span className="ahora">dentro</span> : d.salida ? hhmm(d.salida) : <span className="falta">sin salida</span>}{d.franjas.length > 1 && <span className="n-franjas" title={`${d.franjas.length} franjas`}>{d.franjas.length}</span>}</td>
                <td className="num">{d.descansos ? textoHoras(d.descansos) : ''}</td>
                <td className="num"><strong>{d.ms ? textoHoras(d.ms) : vacio ? '' : '0 min'}</strong></td>
                <td className="num">{d.esperadas || d.ms ? <Dif ms={d.diferencia} /> : ''}</td>
                <td className="marcas">
                  {d.ediciones.length > 0 && <span className="editado" title={`Editado: ${d.ediciones[0].motivo}`}>EDITADO</span>}
                  {d.sinSalida > 0 && <span className="aviso-sin" title="Se olvidó checar la salida">⚠</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Tarjeta de resumen (semana, mes o año). */
function Resumen({ titulo, r }) {
  const pct = r.esperadasTotal ? Math.min(100, (r.ms / r.esperadasTotal) * 100) : 0
  return (
    <div className="resumen-chk">
      <div className="titulo">{titulo}</div>
      <div className="valor">{textoHoras(r.ms)}</div>
      <div className="barra"><span style={{ width: `${pct}%` }} /></div>
      <div className="pie">
        <span>de {Math.round(r.esperadasTotal / H)} h del periodo</span>
        <span title="Contra lo esperado hasta ayer">{r.esperadasFecha ? <Dif ms={r.diferencia} /> : ''}</span>
      </div>
    </div>
  )
}

// ── Mi checador ──
function MiChecador({ email, nombre, nombrePorEmail }) {
  const ahora = useAhora(1000)
  const hoy = diaIso()
  const [mes, setMes] = useState(mesIso(new Date()))
  const [datos, setDatos] = useState(null)
  const [checando, setChecando] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const anio = mes.slice(0, 4)
  const desde = [`${anio}-01-01`, lunesDe(hoy)].sort()[0]
  const hasta = [`${anio}-12-31`, hoy].sort().at(-1)

  async function cargar() {
    try { setDatos(await cargarChecadas({ desde, hasta, email })) } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ checadas: [], ediciones: [], ausencias: [] }) }
  }
  useEffect(() => { setDatos(null); cargar() }, [email, desde, hasta])

  async function checar() {
    setChecando(true)
    const { data, error } = await supabase.rpc('checar')
    setChecando(false)
    if (error) { toast('No se pudo checar: ' + error.message, true); return }
    toast(data?.salida ? `Salida a las ${hora(data.salida)} ✓` : `Entrada a las ${hora(data?.entrada || new Date())} ✓`)
    cargar()
  }

  const ch = datos?.checadas || [], ed = datos?.ediciones || [], au = datos?.ausencias || []
  const hoyDia = resumenDia(hoy, ch.filter(c => c.fecha === hoy), ed, ahora, au)
  const dentro = hoyDia.franjas.find(abierta)
  const { desde: dMes, hasta: hMes } = rangoDelMes(mes)
  const ahoraLento = Math.floor(ahora / 15000) * 15000
  const rSemana = useMemo(() => resumenPeriodo(lunesDe(hoy), sumarDias(lunesDe(hoy), 6), ch, ed, ahoraLento, au), [datos, ahoraLento])
  const rMes = useMemo(() => resumenPeriodo(dMes, hMes, ch, ed, ahoraLento, au), [datos, ahoraLento, mes])
  const rAnio = useMemo(() => resumenPeriodo(`${anio}-01-01`, `${anio}-12-31`, ch, ed, ahoraLento, au), [datos, ahoraLento, anio])
  const pctHoy = Math.min(100, (hoyDia.ms / (HORARIO.horas * H)) * 100)
  const reloj = new Date(ahora).toLocaleTimeString('es-MX', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const fechaHoy = mayuscula(new Date(ahora).toLocaleDateString('es-MX', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' }))
  const dias = rMes.dias
  const iAbierto = dias.findIndex(d => d.fecha === abierto)

  return (
    <>
      <section className={`hoy-chk ${dentro ? 'dentro' : ''}`}>
        <div className="hora">
          <div className="fecha">{fechaHoy}</div>
          <div className="reloj">{reloj}</div>
          <div className="estado">{dentro ? <>Dentro desde las <strong>{hora(dentro.entrada)}</strong></> : hoyDia.franjas.length ? <>Fuera · saliste a las {hora(hoyDia.franjas.at(-1).salida)}</> : 'Todavía no checas hoy'}</div>
        </div>
        <div className="avance">
          <div className="cifras"><strong className="cronometro">{cronometro(hoyDia.ms)}</strong><span>de {HORARIO.horas} h · horario {HORARIO.bloques}</span></div>
          <div className="barra"><span style={{ width: `${pctHoy}%` }} /></div>
          <div className="franjas-hoy">
            {hoyDia.franjas.length === 0 ? <span className="vacio">Sin franjas hoy</span> : hoyDia.franjas.map(f => <span key={f.id} className={abierta(f) ? 'abierta' : ''}>{hhmm(f.entrada)} → {f.salida ? hhmm(f.salida) : 'ahora'}</span>)}
            <button className="link" onClick={() => setAbierto(hoy)}>ver día</button>
          </div>
        </div>
        <div className="accion">
          <button className={`btn-checar ${dentro ? 'salida' : 'entrada'}`} onClick={checar} disabled={checando || !datos}>
            <span className="punto" />{checando ? 'Checando…' : dentro ? 'Checar salida' : 'Checar entrada'}
          </button>
        </div>
      </section>

      <div className="resumenes-chk">
        <Resumen titulo="Esta semana" r={rSemana} />
        <Resumen titulo={textoMes(mes)} r={rMes} />
        <Resumen titulo={`Año ${anio}`} r={rAnio} />
      </div>

      <div className="section-header" style={{ marginTop: 22 }}><span className="section-title">Mi presencia</span></div>
      <SelectorMes mes={mes} setMes={setMes} ayuda="Clic en un día para ver el detalle o editarlo · solo tú y los administradores ven tus checadas" />
      {rMes.sinSalida > 0 && <div className="aviso-chk">⚠ Tienes {rMes.sinSalida} {rMes.sinSalida === 1 ? 'día' : 'días'} sin salida este mes: ábrelo y corrígelo con “Editar día”.</div>}
      {!datos ? <div className="vacio-chk">Cargando…</div> : <TablaPresencia dias={dias} alAbrir={setAbierto} />}

      {abierto && datos && (
        <PanelDiaChecador
          key={abierto}
          dia={resumenDia(abierto, ch.filter(c => c.fecha === abierto), ed, ahora, au)}
          email={email} nombre={nombre} nombrePorEmail={nombrePorEmail} puedeEditar
          onCerrar={() => setAbierto(null)} onGuardado={cargar}
          anterior={iAbierto >= 0 && iAbierto < dias.length - 1 ? () => setAbierto(dias[iAbierto + 1].fecha) : null}
          siguiente={iAbierto > 0 ? () => setAbierto(dias[iAbierto - 1].fecha) : null}
        />
      )}
    </>
  )
}

// ── Administrador ──
function AdminChecador() {
  const ahora = useAhora(30000)
  const hoy = diaIso()
  const [mes, setMes] = useState(mesIso(new Date()))
  const [datos, setDatos] = useState(null)
  const [deHoy, setDeHoy] = useState(null)
  const [gente, setGente] = useState([])
  const [buscar, setBuscar] = useState('')
  const [persona, setPersona] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const { desde, hasta } = rangoDelMes(mes)

  useEffect(() => { supabase.from('directorio').select('email, nombre, area, puesto, activo').then(({ data }) => setGente(data || [])) }, [])
  async function cargar() {
    try {
      const [m, h] = await Promise.all([cargarChecadas({ desde, hasta }), hoy >= desde && hoy <= hasta ? null : cargarChecadas({ desde: hoy, hasta: hoy })])
      setDatos(m); setDeHoy(h || m)
    } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ checadas: [], ediciones: [], ausencias: [] }); setDeHoy({ checadas: [], ediciones: [], ausencias: [] }) }
  }
  useEffect(() => { setDatos(null); cargar() }, [mes])

  const nombrePorEmail = useMemo(() => Object.fromEntries(gente.map(g => [g.email, g.nombre])), [gente])
  const personas = useMemo(() => {
    const m = new Map(gente.filter(g => g.activo !== false).map(g => [g.email, g]))
    for (const c of [...(datos?.checadas || []), ...(deHoy?.checadas || [])]) if (!m.has(c.email)) m.set(c.email, { email: c.email, nombre: c.email })
    return [...m.values()].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
  }, [gente, datos, deHoy])

  const filas = useMemo(() => {
    if (!datos) return []
    const q = buscar.trim().toLowerCase()
    return personas
      .filter(p => !q || `${p.nombre} ${p.area || ''} ${p.puesto || ''}`.toLowerCase().includes(q))
      .map(p => ({ p, r: resumenPeriodo(desde, hasta, datos.checadas.filter(c => c.email === p.email), datos.ediciones.filter(e => e.email === p.email), ahora, (datos.ausencias || []).filter(a => a.email === p.email)) }))
  }, [personas, datos, buscar, ahora, desde, hasta])

  // Ahora mismo
  const estadoHoy = useMemo(() => {
    if (!deHoy) return null
    const out = { dentro: [], salieron: [], sin: [], ausentes: [] }
    for (const p of personas) {
      const fs = deHoy.checadas.filter(c => c.email === p.email && c.fecha === hoy)
      const a = fs.find(abierta)
      const aus = (deHoy.ausencias || []).find(x => x.email === p.email && x.inicio <= hoy && x.fin >= hoy)
      if (a) out.dentro.push({ p, desde: a.entrada })
      else if (fs.length) out.salieron.push({ p, desde: fs.map(f => f.salida).sort().at(-1) })
      else if (aus) out.ausentes.push({ p, motivo: motivoAusencia(aus.motivo_id)?.nombre || 'Ausencia' })
      else out.sin.push({ p })
    }
    return out
  }, [deHoy, personas])

  const tot = filas.reduce((s, f) => ({ ms: s.ms + f.r.ms, esp: s.esp + f.r.esperadasFecha, dif: s.dif + f.r.diferencia, ed: s.ed + f.r.editados, sin: s.sin + f.r.sinSalida }), { ms: 0, esp: 0, dif: 0, ed: 0, sin: 0 })
  const sel = persona && filas.find(f => f.p.email === persona)
  const diasSel = sel?.r.dias || []
  const iAbierto = diasSel.findIndex(d => d.fecha === abierto)

  return (
    <>
      {estadoHoy && (
        <section className="ahora-chk">
          <div className="titulo">Ahora · {textoDia(hoy)}</div>
          <div className="columnas">
            <div className="col dentro"><div className="cab"><span className="pt" />Dentro <b>{estadoHoy.dentro.length}</b></div>{estadoHoy.dentro.map(x => <span key={x.p.email} className="persona-chip">{x.p.nombre} <i>desde {hhmm(x.desde)}</i></span>)}</div>
            <div className="col salieron"><div className="cab"><span className="pt" />Ya salieron <b>{estadoHoy.salieron.length}</b></div>{estadoHoy.salieron.map(x => <span key={x.p.email} className="persona-chip">{x.p.nombre} <i>{hhmm(x.desde)}</i></span>)}</div>
            <div className="col sin"><div className="cab"><span className="pt" />Sin checar hoy <b>{estadoHoy.sin.length}</b></div>{estadoHoy.sin.map(x => <span key={x.p.email} className="persona-chip">{x.p.nombre}</span>)}{estadoHoy.ausentes.length > 0 && <div className="ausentes-hoy">Ausentes: {estadoHoy.ausentes.map(x => <span key={x.p.email} className="persona-chip aus">{x.p.nombre} <i>{x.motivo}</i></span>)}</div>}</div>
          </div>
        </section>
      )}

      <SelectorMes mes={mes} setMes={m => { setMes(m); setPersona(null) }} ayuda="Clic en una persona para ver sus días; clic en un día para ver el detalle o editarlo" />
      <div className="kpis-proy">
        <div className="stat-box"><div className="stat-label">Horas del equipo</div><div className="stat-value green">{textoHoras(tot.ms)}</div><div className="stat-sub">{textoMes(mes)}</div></div>
        <div className="stat-box"><div className="stat-label">Contra lo esperado</div><div className="stat-value"><Dif ms={tot.dif} /></div><div className="stat-sub">hasta ayer · {Math.round(tot.esp / H)} h esperadas</div></div>
        <div className="stat-box"><div className="stat-label">Días editados</div><div className="stat-value">{tot.ed}</div><div className="stat-sub">marcados como EDITADO</div></div>
        <div className="stat-box"><div className="stat-label">Sin salida</div><div className="stat-value" style={{ color: tot.sin ? '#9A5B00' : undefined }}>{tot.sin}</div><div className="stat-sub">franjas por corregir</div></div>
      </div>
      <input className="buscar-chk" placeholder="Buscar persona, área o puesto…" value={buscar} onChange={e => setBuscar(e.target.value)} />
      {!datos ? <div className="vacio-chk">Cargando…</div> : (
        <div className="tabla-chk-wrap" style={{ marginTop: 10 }}>
          <table className="tabla-chk admin">
            <thead><tr><th>Persona</th><th className="num">Horas</th><th className="num">Esperadas</th><th className="num">Diferencia</th><th className="num">Días</th><th>Avisos</th></tr></thead>
            <tbody>
              {filas.map(({ p, r }) => {
                const ab = persona === p.email
                return [
                  <tr key={p.email} className={`persona ${ab ? 'abierta' : ''} ${r.ms ? '' : 'sin-horas'}`} onClick={() => setPersona(ab ? null : p.email)}>
                    <td><span className="flecha">{ab ? '▾' : '▸'}</span> <strong>{p.nombre}</strong><div className="sub">{[p.area, p.puesto].filter(Boolean).join(' · ')}</div></td>
                    <td className="num"><strong>{textoHoras(r.ms)}</strong></td>
                    <td className="num">{Math.round(r.esperadasFecha / H)} h</td>
                    <td className="num"><Dif ms={r.diferencia} /></td>
                    <td className="num">{r.trabajados}</td>
                    <td className="marcas">{r.editados > 0 && <span className="editado">{r.editados} EDITADO</span>}{r.sinSalida > 0 && <span className="aviso-sin">⚠ {r.sinSalida} sin salida</span>}</td>
                  </tr>,
                  ab && <tr key={p.email + '-d'} className="detalle"><td colSpan={6}><TablaPresencia dias={r.dias} alAbrir={setAbierto} /></td></tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {abierto && sel && (
        <PanelDiaChecador
          key={persona + abierto}
          dia={diasSel[iAbierto] || resumenDia(abierto, [], [], ahora)}
          email={sel.p.email} nombre={sel.p.nombre} nombrePorEmail={nombrePorEmail} puedeEditar
          onCerrar={() => setAbierto(null)} onGuardado={cargar}
          anterior={iAbierto >= 0 && iAbierto < diasSel.length - 1 ? () => setAbierto(diasSel[iAbierto + 1].fecha) : null}
          siguiente={iAbierto > 0 ? () => setAbierto(diasSel[iAbierto - 1].fecha) : null}
        />
      )}
    </>
  )
}

/** Días propios de BEA: festivos (no se trabaja) y eventos. Solo administradores. */
function CalendarioBea({ dias, alCambiar }) {
  const [nuevo, setNuevo] = useState({ fecha: '', nombre: '', tipo: 'festivo' })
  const [verPasados, setVerPasados] = useState(false)
  const hoy = diaIso()
  const lista = dias.filter(d => verPasados || d.fecha >= hoy)
  async function agregar() {
    if (!nuevo.fecha || !nuevo.nombre.trim()) { toast('Pon la fecha y el nombre', true); return }
    const { error } = await supabase.from('calendario_bea').upsert({ ...nuevo, nombre: nuevo.nombre.trim() })
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    toast('Día agregado al calendario ✓'); setNuevo({ fecha: '', nombre: '', tipo: 'festivo' }); alCambiar()
  }
  async function quitar(f) {
    if (!window.confirm(`¿Quitar ${textoDiaLargo(f.fecha)} (${f.nombre}) del calendario de BEA?`)) return
    const { error } = await supabase.from('calendario_bea').delete().eq('fecha', f.fecha)
    if (error) { toast('No se pudo quitar: ' + error.message, true); return }
    alCambiar()
  }
  return (
    <section className="calendario-bea">
      <div className="section-header" style={{ marginTop: 4 }}><span className="section-title">📅 Calendario de BEA</span></div>
      <p className="ayuda" style={{ margin: '0 0 10px' }}>Además de los festivos de ley. <strong>Festivo</strong>: no se trabaja (no cuenta en horas esperadas). <strong>Evento</strong>: día normal, solo se marca.</p>
      <div className="cal-bea-alta">
        <input type="date" value={nuevo.fecha} onChange={e => setNuevo(n => ({ ...n, fecha: e.target.value }))} aria-label="Fecha" />
        <input placeholder="Nombre (ej. Asueto Noche Buena)" value={nuevo.nombre} onChange={e => setNuevo(n => ({ ...n, nombre: e.target.value }))} aria-label="Nombre" />
        <select value={nuevo.tipo} onChange={e => setNuevo(n => ({ ...n, tipo: e.target.value }))} aria-label="Tipo"><option value="festivo">Festivo</option><option value="evento">Evento</option></select>
        <button className="btn btn-primary btn-sm" onClick={agregar}>＋ Agregar</button>
      </div>
      <ul className="cal-bea-lista">
        {lista.length === 0 && <li className="vacio">No hay días próximos.</li>}
        {lista.map(f => (
          <li key={f.fecha} className={f.fecha < hoy ? 'pasado' : ''}>
            <span className="fecha">{textoDia(f.fecha)} {f.fecha.slice(0, 4)}</span>
            <span className={f.tipo === 'festivo' ? 'chip-tipo' : 'chip-evento'}>{f.tipo}</span>
            <span className="nombre">{f.nombre}</span>
            <button className="quitar" onClick={() => quitar(f)} aria-label={`Quitar ${f.nombre}`}>✕</button>
          </li>
        ))}
      </ul>
      <button className="link-chk" onClick={() => setVerPasados(v => !v)}>{verPasados ? 'Ocultar pasados' : 'Ver también los pasados'}</button>
    </section>
  )
}

export default function Checador() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const email = (profile?.email || '').toLowerCase()
  const [admin, setAdmin] = useState(false)
  const [veDiario, setVeDiario] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'mio'
  const setTab = t => setParams(t === 'mio' ? {} : { tab: t }, { replace: true })
  const [sub, setSub] = useState('presencia')

  const [gente, setGente] = useState([])
  const [calendario, setCalendario] = useState(null)
  const [motivos, setMotivos] = useState(null)
  const [sinVer, setSinVer] = useState(0)
  async function cargarCalendario() {
    const { data } = await supabase.from('calendario_bea').select('*').order('fecha')
    setCalendarioBea(data || []); setCalendario(data || [])
  }
  async function recargarMotivos() {
    try { const m = await cargarMotivos(); setMotivosAusencia(m); setMotivos(m) } catch { setMotivosAusencia([]); setMotivos([]) }
  }
  const contarSinVer = () => email && anunciosSinVer(email).then(setSinVer).catch(() => {})
  useEffect(() => { cargarCalendario(); recargarMotivos() }, [])
  useEffect(() => { if (email) { supabase.rpc('es_admin_checador').then(({ data }) => setAdmin(!!data)); puedeVerReporteDiario().then(setVeDiario); contarSinVer() } }, [email])
  useEffect(() => { supabase.from('directorio').select('email, nombre, area, puesto, activo').then(({ data }) => setGente(data || [])) }, [])

  const nombres = useMemo(() => Object.fromEntries(gente.map(d => [d.email, d.nombre])), [gente])
  const personas = useMemo(() => gente.filter(g => g.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')), [gente])
  const listo = email && calendario && motivos
  const pestanas = [
    ['mio', 'Mi checador', 'checar y ver mis horas'],
    ['ausencias', 'Ausencias', 'vacaciones y permisos'],
    ['anuncios', <>Anuncios{sinVer > 0 && <b className="badge-nuevo">{sinVer}</b>}</>, 'avisos de BEA'],
    ...(veDiario ? [['reporte', 'Reporte', 'asistencia, faltas y retardos']] : []),
    ...(admin ? [['admin', '👥 Administrador', 'equipo, aprobaciones y ajustes']] : []),
  ]

  let contenido = null
  if (listo) {
    if (tab === 'ausencias') contenido = <MisAusencias email={email} motivos={motivos} nombres={nombres} />
    else if (tab === 'reporte' && veDiario) contenido = <ReporteChecador />
    else if (tab === 'anuncios') contenido = <Anuncios email={email} admin={admin} nombres={nombres} personas={personas} alCambiarVistos={contarSinVer} />
    else if (tab === 'admin' && admin) contenido = (
      <>
        <div className="subpestanas-rh principal">
          {[['presencia', 'Presencia del equipo'], ['ausencias', 'Ausencias'], ['calendario', 'Calendario de BEA']].map(([k, t]) => (
            <button key={k} className={sub === k ? 'activa' : ''} onClick={() => setSub(k)}>{t}</button>
          ))}
        </div>
        {sub === 'presencia' && <AdminChecador key={calendario.length} />}
        {sub === 'ausencias' && <AdminAusencias yo={email} motivos={motivos} recargarMotivos={recargarMotivos} nombres={nombres} personas={personas} />}
        {sub === 'calendario' && <CalendarioBea dias={calendario} alCambiar={cargarCalendario} />}
      </>
    )
    else contenido = <MiChecador email={email} nombre={profile?.nombre || email} nombrePorEmail={nombres} />
  }

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/proyectos')}>Mis Proyectos</a><span className="sep">›</span><span className="current">Checador</span>
      </div>
      <h1 className="page-title">Checador</h1>
      <div className="pestanas-proy" role="tablist">
        {pestanas.map(([k, t, d]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'activa' : ''} onClick={() => setTab(k)}><div className="t-pest">{t}</div><span>{d}</span></button>)}
      </div>
      {contenido || <div className="vacio-chk">Cargando…</div>}
    </div>
  )
}
