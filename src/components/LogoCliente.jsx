import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'

const BUCKET = 'formatos-cliente'

/** Bytes, tipo y tamaño del logo del cliente (para el Excel del reporte). null si no hay. */
export async function leerLogoCliente(project) {
  if (!project?.logo_cliente) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(project.logo_cliente)
  if (error || !data) return null
  const extension = /\.png$/i.test(project.logo_cliente) ? 'png' : 'jpeg'
  let width = 190, height = 50
  try { const bmp = await createImageBitmap(data); width = bmp.width; height = bmp.height; bmp.close?.() } catch { /* tamaño por omisión */ }
  return { buffer: await data.arrayBuffer(), extension, width, height }
}

/** Logo del cliente que va arriba a la izquierda del reporte mensual RC-OP-01 */
export default function LogoCliente({ project, puedeCambiar, onCambio }) {
  const [url, setUrl] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const input = useRef(null)

  useEffect(() => {
    let vivo = true, liberar = null
    setUrl(null)
    if (project.logo_cliente) {
      supabase.storage.from(BUCKET).download(project.logo_cliente).then(({ data }) => {
        if (!vivo || !data) return
        liberar = URL.createObjectURL(data); setUrl(liberar)
      })
    }
    return () => { vivo = false; if (liberar) URL.revokeObjectURL(liberar) }
  }, [project.logo_cliente])

  async function subir(e) {
    const file = e.target.files[0]; e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('El logo debe ser PNG o JPG', true); return }
    setSubiendo(true)
    const ext = file.type === 'image/png' ? 'png' : 'jpg'
    const ruta = `${project.id}/logo-cliente-${Date.now()}.${ext}`
    const up = await supabase.storage.from(BUCKET).upload(ruta, file, { contentType: file.type })
    if (up.error) { toast('No se pudo subir el logo: ' + up.error.message, true); setSubiendo(false); return }
    const { error } = await supabase.from('projects').update({ logo_cliente: ruta }).eq('id', project.id)
    setSubiendo(false)
    if (error) { toast('No se guardó el logo: ' + error.message, true); return }
    onCambio?.(ruta)
    toast('Logo del cliente guardado ✓')
  }

  if (!puedeCambiar && !project.logo_cliente) return null
  return (
    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>Logo del cliente en el reporte:</span>
      {url ? <img src={url} alt="Logo del cliente" style={{ maxHeight: 36, maxWidth: 140, border: '1px solid var(--border)', borderRadius: 4, padding: 2, background: '#fff' }} />
        : <span style={{ color: 'var(--text-muted)' }}>sin logo</span>}
      {puedeCambiar && <>
        <button className="btn btn-sm btn-outline" disabled={subiendo} onClick={() => input.current.click()}>{subiendo ? 'Subiendo…' : project.logo_cliente ? 'Cambiar logo' : 'Subir logo'}</button>
        <input ref={input} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={subir} />
      </>}
    </div>
  )
}
