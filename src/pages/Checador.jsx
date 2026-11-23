import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/Toast'
import PanelDiaChecador from '../components/PanelDiaChecador'
import { mesIso, sumarMeses, textoMes } from '../lib/proyecciones'
import {
  ZONA, HORARIO, mayuscula, diaIso, hhmm, hora, textoDia, abierta, textoHoras, resumenDia, resumenPeriodo,
  cargarChecadas, rangoDelMes, lunesDe, sumarDias,
} from '../lib/checador'

const H = 3600000

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
                  {d.tipo === 'festivo' && <span className="chip-tipo">festivo</span>}
                </td>
                <td className="hm">{vacio ? (d.tipo === 'laborable' && d.fecha < hoy ? <span className="falta">sin checadas</span> : '—') : hhmm(d.entrada)}</td>
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
  const ahora = useAhora(15000)
  const hoy = diaIso()
  const [mes, setMes] = useState(mesIso(new Date()))
  const [datos, setDatos] = useState(null)
  const [checando, setChecando] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const anio = mes.slice(0, 4)
  const desde = [`${anio}-01-01`, lunesDe(hoy)].sort()[0]
  const hasta = [`${anio}-12-31`, hoy].sort().at(-1)

  async function cargar() {
    try { setDatos(await cargarChecadas({ desde, hasta, email })) } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ checadas: [], ediciones: [] }) }
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

  const ch = datos?.checadas || [], ed = datos?.ediciones || []
  const hoyDia = resumenDia(hoy, ch.filter(c => c.fecha === hoy), ed, ahora)
  const dentro = hoyDia.franjas.find(abierta)
  const { desde: dMes, hasta: hMes } = rangoDelMes(mes)
  const rSemana = useMemo(() => resumenPeriodo(lunesDe(hoy), sumarDias(lunesDe(hoy), 6), ch, ed, ahora), [datos, ahora])
  const rMes = useMemo(() => resumenPeriodo(dMes, hMes, ch, ed, ahora), [datos, ahora, mes])
  const rAnio = useMemo(() => resumenPeriodo(`${anio}-01-01`, `${anio}-12-31`, ch, ed, ahora), [datos, ahora, anio])
  const pctHoy = Math.min(100, (hoyDia.ms / (HORARIO.horas * H)) * 100)
  const reloj = new Date(ahora).toLocaleTimeString('es-MX', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' })
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
          <div className="cifras"><strong>{textoHoras(hoyDia.ms)}</strong><span>de {HORARIO.horas} h · horario {HORARIO.inicio}–{HORARIO.fin}</span></div>
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
          dia={resumenDia(abierto, ch.filter(c => c.fecha === abierto), ed, ahora)}
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
    } catch (e) { toast('No se pudo cargar: ' + e.message, true); setDatos({ checadas: [], ediciones: [] }); setDeHoy({ checadas: [], ediciones: [] }) }
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
      .map(p => ({ p, r: resumenPeriodo(desde, hasta, datos.checadas.filter(c => c.email === p.email), datos.ediciones.filter(e => e.email === p.email), ahora) }))
  }, [personas, datos, buscar, ahora, desde, hasta])

  // Ahora mismo
  const estadoHoy = useMemo(() => {
    if (!deHoy) return null
    const out = { dentro: [], salieron: [], sin: [] }
    for (const p of personas) {
      const fs = deHoy.checadas.filter(c => c.email === p.email && c.fecha === hoy)
      const a = fs.find(abierta)
      if (a) out.dentro.push({ p, desde: a.entrada })
      else if (fs.length) out.salieron.push({ p, desde: fs.map(f => f.salida).sort().at(-1) })
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
            <div className="col sin"><div className="cab"><span className="pt" />Sin checar hoy <b>{estadoHoy.sin.length}</b></div>{estadoHoy.sin.map(x => <span key={x.p.email} className="persona-chip">{x.p.nombre}</span>)}</div>
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

export default function Checador() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const email = (profile?.email || '').toLowerCase()
  const [admin, setAdmin] = useState(false)
  const [tab, setTab] = useState('mio')

  const [nombres, setNombres] = useState({})
  useEffect(() => { if (email) supabase.rpc('es_admin_checador').then(({ data }) => setAdmin(!!data)) }, [email])
  useEffect(() => { supabase.from('directorio').select('email, nombre').then(({ data }) => setNombres(Object.fromEntries((data || []).map(d => [d.email, d.nombre])))) }, [])

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span><span className="current">Checador</span>
      </div>
      <h1 className="page-title">Checador</h1>
      {admin && (
        <div className="pestanas-proy" role="tablist">
          <button role="tab" aria-selected={tab === 'mio'} className={tab === 'mio' ? 'activa' : ''} onClick={() => setTab('mio')}>Mi checador<span>checar y ver mis horas</span></button>
          <button role="tab" aria-selected={tab === 'admin'} className={tab === 'admin' ? 'activa' : ''} onClick={() => setTab('admin')}>👥 Administrador<span>todo el equipo · editar días</span></button>
        </div>
      )}
      {!email ? <div className="vacio-chk">Cargando…</div> : admin && tab === 'admin' ? <AdminChecador /> : <MiChecador email={email} nombre={profile?.nombre || email} nombrePorEmail={nombres} />}
    </div>
  )
}
