import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'
import { NOMBRE_FORMATO } from '../lib/formatosCliente'

const BUCKET = 'formatos-cliente'
const cargarJSZip = () => import('jszip').then(m => m.default)
const cargarMotor = () => import('../lib/formatosCliente')

export async function listarFormatos(projectId) {
  const { data } = await supabase.from('formatos_cliente').select('*').eq('project_id', projectId).order('nombre')
  return data || []
}

async function bajarPlantilla(f) {
  const { data, error } = await supabase.storage.from(BUCKET).download(f.archivo)
  if (error) throw new Error('No se pudo leer la plantilla: ' + error.message)
  return data.arrayBuffer()
}

async function subirArchivo(projectId, nombre, bytes) {
  const limpio = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')
  const ruta = `${projectId}/${Date.now()}-${limpio}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, new Blob([bytes]), {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  if (error) throw new Error('No se pudo guardar el archivo: ' + error.message)
  return ruta
}

function descargar(bytes, nombre) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const nombreSalida = (project, f, numero) => `${(project.name || '').split(/[-_]/)[0]}-Estimación ${f.nombre || NOMBRE_FORMATO[f.tipo]} ${numero}.xlsx`

export async function generar(f, conceptos, periodo) {
  const [JSZip, motor] = await Promise.all([cargarJSZip(), cargarMotor()])
  return motor.generarFormatoCliente(JSZip, await bajarPlantilla(f), conceptos, periodo)
}

/**
 * Al marcar la estimación como Enviada: la estimación generada queda como plantilla del mes siguiente.
 * Devuelve la lista de formatos que no se pudieron actualizar.
 */
export async function avanzarFormatos(project, conceptos, periodo) {
  const errores = []
  for (const f of await listarFormatos(project.id)) {
    try {
      const r = await generar(f, conceptos, periodo)
      const nombre = nombreSalida(project, f, r.numero)
      const ruta = await subirArchivo(project.id, nombre, r.buffer)
      const { error } = await supabase.from('formatos_cliente').update({ archivo: ruta, archivo_nombre: nombre, numero: r.numero, actualizado_at: new Date().toISOString() }).eq('id', f.id)
      if (error) throw error
    } catch (e) { errores.push(`${f.nombre}: ${e.message}`) }
  }
  return errores
}

/** Sección "Formatos del cliente" de la hoja para cliente */
export default function FormatosCliente({ project, conceptos, periodo, puedeAdministrar }) {
  const [formatos, setFormatos] = useState(null)
  const [trabajando, setTrabajando] = useState(null)
  const [aviso, setAviso] = useState(null) // { f, r } revisión antes de descargar
  const fileRef = useRef(null)
  const reemplazar = useRef(null)

  async function cargar() { setFormatos(await listarFormatos(project.id)) }
  useEffect(() => { cargar() }, [project.id])

  async function alSubir(e) {
    const file = e.target.files[0]; e.target.value = ''
    if (!file) return
    setTrabajando('subir')
    try {
      const bytes = await file.arrayBuffer()
      const [JSZip, motor] = await Promise.all([cargarJSZip(), import('../lib/xlsxCeldas')])
      const libro = await motor.abrirXlsx(JSZip, bytes)
      const { detectarFormato } = await cargarMotor()
      const tipo = detectarFormato(libro)
      if (!tipo) throw new Error('No reconozco este formato. Por ahora la app llena los del Tec de Monterrey y STIVA.')
      const ruta = await subirArchivo(project.id, file.name, bytes)
      const fase = /constru/i.test(file.name) ? ' · Construcción' : /dise[nñ]o/i.test(file.name) ? ' · Diseño' : ''
      const previo = reemplazar.current
      const fila = { project_id: project.id, tipo, archivo: ruta, archivo_nombre: file.name, nombre: previo?.nombre || NOMBRE_FORMATO[tipo] + fase, actualizado_at: new Date().toISOString() }
      const { error } = previo
        ? await supabase.from('formatos_cliente').update(fila).eq('id', previo.id)
        : await supabase.from('formatos_cliente').insert(fila)
      if (error) throw error
      toast(`Formato ${NOMBRE_FORMATO[tipo]} guardado ✓`)
      await cargar()
    } catch (err) { toast(err.message, true) }
    reemplazar.current = null
    setTrabajando(null)
  }

  async function alGenerar(f, aunAsi = false) {
    setTrabajando(f.id)
    try {
      const r = aviso?.f?.id === f.id ? aviso.r : await generar(f, conceptos, periodo)
      if (!aunAsi && (r.diferencias.length || r.sinRenglon.length)) { setAviso({ f, r }); setTrabajando(null); return }
      descargar(r.buffer, nombreSalida(project, f, r.numero))
      setAviso(null)
    } catch (err) { toast(err.message, true) }
    setTrabajando(null)
  }

  async function quitar(f) {
    if (!window.confirm(`¿Quitar el formato "${f.nombre}" de este proyecto? El archivo se conserva en el historial.`)) return
    const { error } = await supabase.from('formatos_cliente').delete().eq('id', f.id)
    if (error) toast(error.message, true); else cargar()
  }

  if (!formatos) return null
  return (
    <div className="card no-print" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>Formato del cliente</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {formatos.length ? 'Sale la misma estimación en el formato propio del cliente, a partir de la última que se le mandó.'
              : 'Si el cliente pide su propio formato (Tec, STIVA…), sube aquí la última estimación que se le mandó en ese formato.'}
          </div>
        </div>
        {puedeAdministrar && (
          <button className="btn btn-sm btn-outline" disabled={trabajando === 'subir'} onClick={() => { reemplazar.current = null; fileRef.current.click() }}>
            {trabajando === 'subir' ? 'Subiendo…' : '＋ Agregar formato'}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" style={{ display: 'none' }} onChange={alSubir} />
      </div>

      {formatos.map(f => (
        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 12 }}>
            <strong>{f.nombre}</strong>
            <div style={{ color: 'var(--text-muted)' }}>
              Plantilla: {f.archivo_nombre}{f.numero ? ` · última enviada: No. ${f.numero}` : ''} · {new Date(f.actualizado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={trabajando === f.id} onClick={() => alGenerar(f)}>
              {trabajando === f.id ? 'Generando…' : `⬇ Descargar formato ${NOMBRE_FORMATO[f.tipo]}`}
            </button>
            {puedeAdministrar && <>
              <button className="btn btn-sm btn-outline" onClick={() => { reemplazar.current = f; fileRef.current.click() }}>Reemplazar plantilla</button>
              <button className="btn btn-sm btn-outline" onClick={() => quitar(f)}>Quitar</button>
            </>}
          </div>
          {aviso?.f?.id === f.id && (
            <div style={{ width: '100%', fontSize: 12, background: 'var(--warning-soft)', color: 'var(--text)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              {aviso.r.diferencias.length > 0 && <>
                <strong>La plantilla no coincide con lo ya cobrado</strong> en {aviso.r.diferencias.length} concepto{aviso.r.diferencias.length > 1 ? 's' : ''}.
                ¿Es la última estimación que se le mandó al cliente? Si no, usa "Reemplazar plantilla".
                <div style={{ margin: '4px 0', color: 'var(--text-muted)' }}>
                  {aviso.r.diferencias.slice(0, 6).map(d => `${d.clave}: archivo ${d.archivo} · app ${d.app}`).join(' · ')}{aviso.r.diferencias.length > 6 ? ' …' : ''}
                </div>
              </>}
              {aviso.r.sinRenglon.length > 0 && <div>
                Estos conceptos de este mes no vienen en esta plantilla (¿van en el formato de otra fase?): {aviso.r.sinRenglon.map(c => c.clave).join(', ')}
              </div>}
              <div className="flex" style={{ gap: 6, marginTop: 6 }}>
                <button className="btn btn-sm btn-outline" onClick={() => alGenerar(f, true)}>Descargar de todos modos</button>
                <button className="btn btn-sm btn-outline" onClick={() => setAviso(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
