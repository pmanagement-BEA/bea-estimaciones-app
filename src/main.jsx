import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { aplicarTema, temaGuardado } from './lib/tema'
import { recargarPorVersion } from './lib/cargarModulo'

// La app se actualizó con la pestaña abierta: trae la versión nueva en lugar de fallar
window.addEventListener('vite:preloadError', e => { if (recargarPorVersion()) e.preventDefault() })

aplicarTema(temaGuardado())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
