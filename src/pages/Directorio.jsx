import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/Toast'
import {
  AREAS_DIRECTORIO, ROLES_APP, fetchDirectorio, normEmail, parseDirectorioPaste,
} from '../lib/directorio'
import { asignarContrasenaTemporal, fetchCuentas, generarTemporal } from '../lib/accesos'

const EMPTY = { email: '', nombre: '', area: '', puesto: '', rol_app: 'colaborador', activo: true }

export default function Directorio() {
  const { profile } = useAuth()
  const isCoord = profile?.role === 'coordinador'
  const [rows, setRows] = useState([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('Todas')
  const [nuevo, setNuevo] = useState(EMPTY)
  const [paste, setPaste] = useState('')
  const [preview, setPreview] = useState(null)
  const [cuentas, setCuentas] = useState({})
  const [clave, setClave] = useState(null) // { email, valor, lista }

  useEffect(() => { load() }, [profile?.role])

  async function load() {
    setLoading(true)
    const res = await fetchDirectorio()
    setAvailable(res.available)
    setRows(res.data)
    if (profile?.role === 'coordinador') setCuentas(await fetchCuentas())
    setLoading(false)
  }

  async function guardarClave() {
    const { resultado, error } = await asignarContrasenaTemporal(clave.email, clave.valor)
    if (error) { toast('No se pudo: ' + error.message, true); return }
    setClave({ ...clave, lista: true })
    toast(resultado === 'creada' ? 'Cuenta creada ✓' : 'Contraseña temporal asignada ✓')
    setCuentas(await fetchCuentas())
  }

  async function saveRow(row) {
    const payload = { ...row, email: normEmail(row.email), area: row.area || null }
    const { error } = await supabase.from('directorio').upsert(payload)
    if (error) { toast('No se pudo guardar: ' + error.message, true); return false }
    return true
  }

  async function updateField(email, field, value) {
    const row = rows.find(r => r.email === email)
    if (!row) return
    const updated = { ...row, [field]: value }
    setRows(prev => prev.map(r => r.email === email ? updated : r))
    if (await saveRow(updated)) toast('Guardado ✓')
  }

  async function addOne() {
    if (!normEmail(nuevo.email).includes('@')) { toast('Escribe un correo válido', true); return }
    if (!nuevo.nombre.trim()) { toast('Escribe el nombre', true); return }
    if (await saveRow(nuevo)) {
      toast('Colaborador agregado ✓')
      setNuevo(EMPTY)
      load()
    }
  }

  async function importPreview() {
    if (!preview?.rows.length) return
    const { error } = await supabase.from('directorio').upsert(preview.rows)
    if (error) { toast('Error al importar: ' + error.message, true); return }
    toast(`${preview.rows.length} colaboradores cargados ✓`)
    setPaste(''); setPreview(null)
    load()
  }

  if (loading) return <div className="main"><div className="spinner" /></div>

  if (!available) {
    return (
      <div className="main">
        <h1 className="page-title">Directorio <span className="accent">BEA</span></h1>
        <div className="card" style={{ marginTop: 16 }}>
          Falta correr <code>supabase/migration_2026_11_directorio.sql</code> en Supabase para activar el directorio.
        </div>
      </div>
    )
  }

  const q = filter.trim().toLowerCase()
  const visible = rows.filter(r =>
    (areaFilter === 'Todas' || (r.area || 'Sin área') === areaFilter) &&
    (!q || r.nombre.toLowerCase().includes(q) || r.email.includes(q) || (r.puesto || '').toLowerCase().includes(q)))
  const countBy = a => rows.filter(r => r.activo && r.area === a).length

  return (
    <div className="main">
      <div className="page-header">
        <div>
          <h1 className="page-title">Directorio <span className="accent">BEA</span></h1>
          <div className="page-subtitle">
            {rows.filter(r => r.activo).length} colaboradores activos ·{' '}
            {AREAS_DIRECTORIO.map(a => `${a}: ${countBy(a)}`).join(' · ')}
          </div>
        </div>
      </div>

      {isCoord && (
        <div className="grid grid-2 mb-md" style={{ gap: 16 }}>
          <div className="card">
            <div className="section-header"><div className="section-title">Agregar colaborador</div></div>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div className="field"><label>Nombre</label>
                <input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
              <div className="field"><label>Correo</label>
                <input type="email" value={nuevo.email} placeholder="nombre@bioconstruccion.com.mx"
                  onChange={e => setNuevo({ ...nuevo, email: e.target.value })} /></div>
              <div className="field"><label>Área</label>
                <select value={nuevo.area} onChange={e => setNuevo({ ...nuevo, area: e.target.value })}>
                  <option value="">— Seleccionar —</option>
                  {AREAS_DIRECTORIO.map(a => <option key={a}>{a}</option>)}
                </select></div>
              <div className="field"><label>Puesto</label>
                <input value={nuevo.puesto} onChange={e => setNuevo({ ...nuevo, puesto: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Permisos en la app</label>
                <select value={nuevo.rol_app} onChange={e => setNuevo({ ...nuevo, rol_app: e.target.value })}>
                  {ROLES_APP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={addOne}>+ Agregar</button>
          </div>

          <div className="card">
            <div className="section-header"><div className="section-title">Cargar varios desde Excel</div></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Copia las columnas <strong>Nombre · Correo · Área · Puesto · Rol</strong> de Excel o Sheets y pégalas aquí.
              Si el correo ya existe, se actualiza.
            </div>
            <textarea rows={6} value={paste} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'Ana Pérez\tapérez@bioconstruccion.com.mx\tCommissioning\tLíder Cx\tlíder'}
              onChange={e => { setPaste(e.target.value); setPreview(e.target.value.trim() ? parseDirectorioPaste(e.target.value) : null) }} />
            {preview && (
              <div style={{ fontSize: 12, marginTop: 8 }}>
                {preview.rows.length} filas listas
                {preview.errors.length > 0 && <span style={{ color: 'var(--danger)' }}> · {preview.errors.join(' · ')}</span>}
                {preview.rows.some(r => !r.area) && <span style={{ color: '#B7791F' }}> · algunas filas sin área reconocida</span>}
              </div>
            )}
            <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!preview?.rows.length} onClick={importPreview}>
              Importar {preview?.rows.length || ''}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input placeholder="Buscar nombre, correo o puesto…" value={filter} onChange={e => setFilter(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
            {['Todas', ...AREAS_DIRECTORIO, 'Sin área'].map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Correo</th><th>Área</th><th>Puesto</th><th>Permisos</th><th className="center">Activo</th>{isCoord && <th>Cuenta</th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                 <tr><td colSpan={isCoord ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>
                  {rows.length === 0 ? 'El directorio está vacío.' : 'Sin resultados'}
                </td></tr>
              ) : visible.map(r => (
                <tr key={r.email} style={{ opacity: r.activo ? 1 : .5 }}>
                  <td>{isCoord
                    ? <input value={r.nombre} onChange={e => setRows(prev => prev.map(x => x.email === r.email ? { ...x, nombre: e.target.value } : x))}
                        onBlur={e => updateField(r.email, 'nombre', e.target.value)} />
                    : r.nombre}</td>
                  <td style={{ fontSize: 12 }}>{r.email}</td>
                  <td>{isCoord
                    ? <select value={r.area || ''} onChange={e => updateField(r.email, 'area', e.target.value || null)}>
                        <option value="">—</option>
                        {AREAS_DIRECTORIO.map(a => <option key={a}>{a}</option>)}
                      </select>
                    : (r.area || '—')}</td>
                  <td>{isCoord
                    ? <input value={r.puesto || ''} onChange={e => setRows(prev => prev.map(x => x.email === r.email ? { ...x, puesto: e.target.value } : x))}
                        onBlur={e => updateField(r.email, 'puesto', e.target.value)} />
                    : r.puesto}</td>
                  <td>{isCoord
                    ? <select value={r.rol_app} onChange={e => updateField(r.email, 'rol_app', e.target.value)}>
                        {ROLES_APP.map(([v]) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    : r.rol_app}</td>
                  <td className="center">
                    <input type="checkbox" checked={r.activo} disabled={!isCoord}
                      onChange={e => updateField(r.email, 'activo', e.target.checked)} />
                  </td>
                  {isCoord && (() => {
                    const c = cuentas[r.email]
                    if (clave?.email === r.email) return (
                      <td style={{ minWidth: 230 }}>
                        {clave.lista ? (
                          <div style={{ fontSize: 12 }}>
                            Dale esta contraseña temporal a {r.nombre.split(' ')[0]}:<br />
                            <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>{clave.valor}</strong><br />
                            <span style={{ color: 'var(--text-muted)' }}>Al entrar, la app le pedirá crear la suya.</span>{' '}
                            <a onClick={() => setClave(null)} style={{ cursor: 'pointer' }}>Listo</a>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input value={clave.valor} onChange={e => setClave({ ...clave, valor: e.target.value })} style={{ fontFamily: 'monospace', width: 130 }} />
                            <button className="btn btn-sm btn-primary" onClick={guardarClave}>Asignar</button>
                            <button className="btn btn-sm btn-outline" onClick={() => setClave(null)}>✕</button>
                          </div>
                        )}
                      </td>
                    )
                    return (
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {!c?.tiene_cuenta ? <span style={{ color: 'var(--text-muted)' }}>Sin cuenta</span>
                          : c.debe_cambiar ? <span style={{ color: 'var(--warning)' }}>Temporal pendiente</span>
                          : <span style={{ color: 'var(--green-dark)' }}>Activa{c.ultimo_acceso ? ` · ${new Date(c.ultimo_acceso).toLocaleDateString('es-MX')}` : ''}</span>}{' '}
                        {r.activo && <button className="btn btn-sm btn-outline" style={{ marginLeft: 6 }} onClick={() => setClave({ email: r.email, valor: generarTemporal(), lista: false })}>
                          🔑 {c?.tiene_cuenta ? 'Restablecer' : 'Crear cuenta'}
                        </button>}
                      </td>
                    )
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
