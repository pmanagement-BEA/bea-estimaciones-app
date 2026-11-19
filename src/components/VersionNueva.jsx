import { useEffect, useState } from 'react'

// Avisa cuando se publica una versión nueva de la app (GitHub Pages guarda la página hasta 10 min
// y una pestaña abierta se queda con la versión con la que cargó).
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
const CADA = 5 * 60 * 1000

const paqueteDe = html => (html.match(/assets\/index-[\w-]+\.js/) || [])[0] || null
const paqueteActual = () => {
  const s = [...document.querySelectorAll('script[src]')].map(x => x.getAttribute('src')).find(x => /assets\/index-[\w-]+\.js/.test(x))
  return s ? s.match(/assets\/index-[\w-]+\.js/)[0] : null
}

export function actualizarApp() {
  // Vuelve a esta misma pantalla después de cargar la versión nueva (ver el script de index.html)
  const ruta = window.location.pathname.replace(BASE, '') || '/'
  try { sessionStorage.setItem('spa-redirect', ruta + window.location.search.replace(/[?&]v=\d+/, '') + window.location.hash) } catch { /* sin almacenamiento */ }
  window.location.replace(`${BASE}/?v=${Date.now()}`)
}

export default function VersionNueva() {
  const [hayNueva, setHayNueva] = useState(false)

  useEffect(() => {
    const actual = paqueteActual()
    if (!actual) return // en desarrollo no hay paquete con nombre
    let vivo = true
    const revisar = async () => {
      try {
        const r = await fetch(`${BASE}/index.html?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const nuevo = paqueteDe(await r.text())
        if (vivo && nuevo && nuevo !== actual) setHayNueva(true)
      } catch { /* sin conexión: se revisa después */ }
    }
    revisar()
    const t = setInterval(revisar, CADA)
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  if (!hayNueva) return null
  return (
    <div className="no-print" role="status" style={{
      position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1000,
      background: 'var(--navy)', color: '#fff', borderRadius: 10, padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 6px 24px rgba(0,0,0,.25)', fontSize: 13, maxWidth: 'calc(100% - 32px)',
    }}>
      <span>Hay una versión nueva de la app. <span style={{ opacity: .75 }}>Guarda tu borrador antes de actualizar.</span></span>
      <button className="btn btn-sm btn-primary" onClick={actualizarApp}>Actualizar</button>
    </div>
  )
}
