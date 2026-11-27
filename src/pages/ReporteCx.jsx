import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/Toast'
import { mesIso, textoMes, nombreCorto } from '../lib/proyecciones'
import { SISTEMAS, ESTADOS_ISSUE, cargarProyectosCx, conceptosCxPendientes, reporteNuevo, guardarReporte, correo, mesMayus, autorPdf } from '../lib/reporteCx'

const lower = s => String(s || '').toLowerCase()
const fechaCorte = f => (f ? f.split('-').reverse().join('/') : '')

// ── Gráficas como las del Sheet ────────────────────────────────────────────
function BarrasMatriz({ matriz }) {
  const filas = SISTEMAS.map(([k, t]) => [t, matriz[k]])
  return (
    <svg viewBox="0 0 300 150" className="rcx-graf" aria-label="Avance por sistema">
      {[0, 25, 50, 75, 100].map(v => <g key={v}><line x1={90 + v * 1.9} x2={90 + v * 1.9} y1={6} y2={128} className="guia" /><text x={90 + v * 1.9} y={140} textAnchor="middle">{v}%</text></g>)}
      {filas.map(([t, v], i) => (
        <g key={t}>
          <text x={86} y={20 + i * 24} textAnchor="end">{t.replace('Sistema ', '').replace('de energía renovable', 'Energía renovable')}</text>
          <rect x={90} y={12 + i * 24} width={190} height={5} className="meta" />
          {v != null && <rect x={90} y={18 + i * 24} width={Math.min(100, +v || 0) * 1.9} height={5} className="avance" />}
        </g>
      ))}
    </svg>
  )
}

function Dona({ issues, titulo }) {
  const tot = SISTEMAS.reduce((a, [k]) => a + (+issues[k]?.abierto || 0) + (+issues[k]?.proceso || 0), 0)
  const cer = SISTEMAS.reduce((a, [k]) => a + (+issues[k]?.cerrado || 0), 0)
  const r = 34, c = 2 * Math.PI * r, f = tot + cer > 0 ? tot / (tot + cer) : 0
  return (
    <svg viewBox="0 0 200 100" className="rcx-graf" aria-label={titulo}>
      <circle cx="55" cy="50" r={r} className="dona-base" />
      {tot + cer > 0 && <circle cx="55" cy="50" r={r} className="dona-abiertos" strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 55 50)" />}
      <text x="55" y="54" textAnchor="middle" className="dona-num">{tot}</text>
      <text x="105" y="40">Abiertos / en proceso: {tot}</text>
      <text x="105" y="58">Cerrados: {cer}</text>
    </svg>
  )
}

// ── Celdas editables ───────────────────────────────────────────────────────
function CeldaNum({ valor, onChange, sufijo = '' }) {
  return <input className="rcx-celda" value={valor ?? ''} inputMode="numeric" onChange={e => onChange(e.target.value === '' ? 0 : Math.max(0, +e.target.value.replace(/[^\d.]/g, '') || 0))} aria-label="valor" placeholder={sufijo ? '0' + sufijo : '0'} />
}

function FilaNA({ na, onNA, children, nombre }) {
  return (
    <tr className={na ? 'na' : ''}>
      <th>{nombre}<label className="rcx-na no-print"><input type="checkbox" checked={na} onChange={e => onNA(e.target.checked)} /> NA</label></th>
      {children}
    </tr>
  )
}

function Seccion({ num, titulo, sub, children }) {
  return (
    <section className="rcx-sec">
      <h3><span>{num}. {titulo}</span> <em>({sub})</em></h3>
      {children}
    </section>
  )
}

function TablaIssues({ issues, set }) {
  return (
    <table className="rcx-tabla">
      <thead><tr><th>Sistema en alcance de Cx</th>{ESTADOS_ISSUE.map(([k, t]) => <th key={k}>{t}</th>)}</tr></thead>
      <tbody>
        {SISTEMAS.map(([k, t]) => {
          const v = issues[k]
          return (
            <FilaNA key={k} nombre={t} na={v == null} onNA={na => set({ ...issues, [k]: na ? null : { ingresos: 0, abierto: 0, proceso: 0, cerrado: 0 } })}>
              {ESTADOS_ISSUE.map(([e]) => <td key={e}>{v == null ? 'NA' : <CeldaNum valor={v[e]} onChange={n => set({ ...issues, [k]: { ...v, [e]: n } })} />}</td>)}
            </FilaNA>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Editor de un reporte ───────────────────────────────────────────────────
function Editor({ item, mes, autor, onVolver, onGuardado }) {
  const [rep, setRep] = useState(() => item.reporte ? { ...item.reporte } : (() => {
    const r = reporteNuevo(item.p.id, mes, item.anterior)
    r.conceptos_cobrar = [...item.proyectados].filter(id => conceptosCxPendientes(item.p).some(x => x.concept.id === id))
    return r
  })())
  const [sucio, setSucio] = useState(!item.reporte)
  const [guardando, setGuardando] = useState(false)
  const pendientes = useMemo(() => conceptosCxPendientes(item.p), [item.p])
  const set = (k, v) => { setRep(r => ({ ...r, [k]: v })); setSucio(true) }
  const elegidos = pendientes.filter(x => rep.conceptos_cobrar.includes(x.concept.id)).map(x => x.concept)
  const mail = correo(item, rep, elegidos)
  const clave = (item.p.name.match(/^\d{3}/) || [''])[0]
  const nombrePdf = `${autorPdf(item.cx[0] ? item.cx[0].nombre : autor)} - ${clave} REPORTE MENSUAL ${mesMayus(mes)} ${mes.slice(0, 4)}`

  async function guardar(estado) {
    setGuardando(true)
    try {
      const g = await guardarReporte({ ...rep, ...(estado ? { estado } : {}) })
      setRep(g); setSucio(false); toast(estado === 'enviado' ? 'Reporte marcado como enviado' : 'Reporte guardado'); onGuardado()
    } catch (e) { toast('No se pudo guardar: ' + (e.message || 'sin permiso para este proyecto'), true) }
    setGuardando(false)
  }
  function exportar() {
    const t = document.title
    document.title = nombrePdf
    window.print()
    setTimeout(() => { document.title = t }, 500)
  }
  const copiar = (txt, que) => navigator.clipboard.writeText(txt).then(() => toast(`${que} copiado`), () => toast('No se pudo copiar', true))

  return (
    <div className="rcx-editor">
      <div className="rcx-barra no-print">
        <button className="btn btn-outline btn-sm" onClick={onVolver}>← Proyectos</button>
        <span className={`rcx-estado ${rep.estado}`}>{rep.estado === 'enviado' ? 'Enviado' : 'Borrador'}</span>
        {sucio && <span className="sub">Cambios sin guardar</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" disabled={guardando} onClick={() => guardar()}>Guardar</button>
        <button className="btn btn-outline btn-sm" onClick={exportar}>Exportar PDF</button>
        <button className="btn btn-primary btn-sm" disabled={guardando} onClick={() => guardar('enviado')}>Marcar como enviado</button>
      </div>

      {!item.reporte && item.anterior && <p className="rcx-aviso no-print">Se copió el reporte de {textoMes(item.anterior.mes)}: actualiza lo que cambió.</p>}

      <div className="rcx-hoja">
        <div className="rcx-cab">
          <div className="rcx-titulo">Reporte Seguimiento de avance de comisionamiento <i>RESUMEN</i></div>
          <img src={`${import.meta.env.BASE_URL}formatos/logo-bea.png`} alt="BEA" className="rcx-logo" onError={e => { e.currentTarget.style.display = 'none' }} />
        </div>
        <div className="rcx-banda">
          <span>Proyecto: {item.p.name}</span>
          <span>FECHA DE CORTE: <input type="date" className="rcx-fecha no-print" value={rep.fecha_corte || ''} onChange={e => set('fecha_corte', e.target.value)} /><b className="solo-print">{fechaCorte(rep.fecha_corte)}</b></span>
        </div>

        <Seccion num={1} titulo="Matriz de equipos" sub="Documento de seguimiento de entregables finales necesarios para el cierre de proyecto, y entrega de manual del sistema">
          <div className="rcx-imp"><b>Importante:</b><textarea value={rep.nota_matriz} onChange={e => set('nota_matriz', e.target.value)} rows={2} placeholder="Ej. Esta etapa aún no inicia, en proceso de diseño" /><div className="solo-print rcx-txt">{rep.nota_matriz}</div></div>
          <div className="rcx-dos">
            <table className="rcx-tabla">
              <thead><tr><th>Sistema en alcance de Cx</th><th>% de avance</th></tr></thead>
              <tbody>
                {SISTEMAS.map(([k, t]) => (
                  <FilaNA key={k} nombre={t} na={rep.matriz[k] == null} onNA={na => set('matriz', { ...rep.matriz, [k]: na ? null : 0 })}>
                    <td>{rep.matriz[k] == null ? 'NA' : <span className="rcx-pct"><CeldaNum valor={rep.matriz[k]} onChange={n => set('matriz', { ...rep.matriz, [k]: Math.min(100, n) })} />%</span>}</td>
                  </FilaNA>
                ))}
              </tbody>
            </table>
            <BarrasMatriz matriz={rep.matriz} />
          </div>
        </Seccion>

        <Seccion num={2} titulo="Issues log de diseño" sub="Incidencias derivadas de documentos de diseño y reuniones">
          <div className="rcx-imp"><b>Importante:</b><textarea value={rep.nota_diseno} onChange={e => set('nota_diseno', e.target.value)} rows={2} /><div className="solo-print rcx-txt">{rep.nota_diseno}</div></div>
          <div className="rcx-dos"><TablaIssues issues={rep.issues_diseno} set={v => set('issues_diseno', v)} /><Dona issues={rep.issues_diseno} titulo="Issues de diseño" /></div>
        </Seccion>

        <Seccion num={3} titulo="Issues log de construcción" sub="Incidencias derivadas de inspección en sitio">
          <div className="rcx-imp"><b>Importante:</b><textarea value={rep.nota_construccion} onChange={e => set('nota_construccion', e.target.value)} rows={2} /><div className="solo-print rcx-txt">{rep.nota_construccion}</div></div>
          <div className="rcx-dos"><TablaIssues issues={rep.issues_construccion} set={v => set('issues_construccion', v)} /><Dona issues={rep.issues_construccion} titulo="Issues de construcción" /></div>
        </Seccion>

        <Seccion num={4} titulo="Reuniones y acuerdos" sub="Acuerdos derivados de reuniones de seguimiento">
          <div className="rcx-imp"><b>Comentarios:</b><textarea value={rep.comentarios} onChange={e => set('comentarios', e.target.value)} rows={3} /><div className="solo-print rcx-txt">{rep.comentarios}</div></div>
        </Seccion>
      </div>

      <div className="rcx-correo no-print">
        <h3>Conceptos a cobrar en {textoMes(mes).toLowerCase()}</h3>
        {pendientes.length ? (
          <ul className="rcx-conceptos">
            {pendientes.map(x => (
              <li key={x.concept.id}>
                <label>
                  <input type="checkbox" checked={rep.conceptos_cobrar.includes(x.concept.id)} onChange={e => set('conceptos_cobrar', e.target.checked ? [...rep.conceptos_cobrar, x.concept.id] : rep.conceptos_cobrar.filter(id => id !== x.concept.id))} />
                  <b>{x.concept.key}</b> {x.concept.description}
                  {item.proyectados.has(x.concept.id) && <span className="rcx-tag">proyectado este mes</span>}
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="sub">No quedan conceptos de Cx por cobrar en este proyecto.</p>}

        <h3>Correo al líder</h3>
        <div className="rcx-mail">
          <div><span>Para</span><b>{item.lider ? `${item.lider.nombre} <${item.lider.email}>` : 'Sin líder asignado'}</b>{mail.para && <button className="btn btn-outline btn-sm" onClick={() => copiar(mail.para, 'Correo')}>Copiar</button>}</div>
          <div><span>Asunto</span><b>{mail.asunto}</b><button className="btn btn-outline btn-sm" onClick={() => copiar(mail.asunto, 'Asunto')}>Copiar</button></div>
          <pre>{mail.cuerpo}</pre>
          <button className="btn btn-outline btn-sm" onClick={() => copiar(mail.cuerpo, 'Texto')}>Copiar texto</button>
          <p className="sub">Adjunta el PDF «{nombrePdf}.pdf» (botón Exportar PDF → Guardar como PDF).</p>
        </div>
      </div>
    </div>
  )
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function ReporteCx() {
  const { profile } = useAuth()
  const [mes, setMes] = useState(mesIso(new Date()))
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [soloMios, setSoloMios] = useState(true)
  const [abierto, setAbierto] = useState(null)

  const cargar = useCallback(async () => {
    setError('')
    try { setItems(await cargarProyectosCx(mes)) } catch (e) { setError(e.message || String(e)) }
  }, [mes])
  useEffect(() => { cargar() }, [cargar])

  const yo = lower(profile?.email)
  const mios = (items || []).filter(i => i.cx.some(c => lower(c.email) === yo) || lower(i.lider?.email) === yo)
  const lista = soloMios && mios.length ? mios : items || []
  const item = abierto && (items || []).find(i => i.p.id === abierto)

  if (item) return <div className="main rcx"><Editor key={item.p.id + mes} item={item} mes={mes} autor={profile?.nombre} onVolver={() => setAbierto(null)} onGuardado={cargar} /></div>

  const enviados = lista.filter(i => i.reporte?.estado === 'enviado').length
  return (
    <div className="main rcx">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte mensual <span className="accent">Cx</span></h1>
          <div className="page-subtitle">{textoMes(mes)} · {enviados} de {lista.length} enviados</div>
        </div>
        <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
          {mios.length > 0 && <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={soloMios} onChange={e => setSoloMios(e.target.checked)} /> Solo mis proyectos</label>}
          <input type="month" className="input rcx-mes" value={mes} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes del reporte" />
        </div>
      </div>
      {error && <div className="card" style={{ color: '#d64545' }}>No se pudo cargar: {error}</div>}
      {!items ? <div className="spinner" /> : (
        <div className="rcx-lista">
          {lista.map(i => {
            const pend = conceptosCxPendientes(i.p)
            const proyectados = pend.filter(x => i.proyectados.has(x.concept.id)).length
            const estado = i.reporte?.estado || 'nuevo'
            return (
              <button key={i.p.id} className={`rcx-card ${estado}`} onClick={() => setAbierto(i.p.id)}>
                <div className="nombre">{i.p.name}{i.p.status !== 'Activo' && <span className="rcx-tag gris">{i.p.status}</span>}</div>
                <div className="sub">Líder: {i.lider ? nombreCorto(i.lider.nombre) : '—'} · Cx: {i.cx.map(c => nombreCorto(c.nombre)).join(', ') || '—'}</div>
                <div className="pie">
                  <span className={`rcx-estado ${estado}`}>{estado === 'enviado' ? 'Enviado' : estado === 'borrador' ? 'Borrador' : 'Sin empezar'}</span>
                  <span className="sub">{i.reporte ? `${i.reporte.conceptos_cobrar.length} conceptos a cobrar` : proyectados ? `${proyectados} proyectados este mes` : 'Sin conceptos proyectados'}</span>
                </div>
              </button>
            )
          })}
          {!lista.length && <p className="dsp-vacio">No hay proyectos activos con Commissioning.</p>}
        </div>
      )}
    </div>
  )
}
