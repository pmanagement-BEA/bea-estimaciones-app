// Carga una parte de la app bajo demanda (ExcelJS, JSZip…). Si la app se actualizó mientras la
// pestaña estaba abierta, el archivo viejo ya no existe en el servidor: en ese caso se recarga la
// página para traer la versión nueva en lugar de fallar en silencio.
const SEÑAL = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError/i

export function esVersionVieja(err) {
  return SEÑAL.test(String(err?.message || err || ''))
}

export function recargarPorVersion() {
  try {
    // Evita recargar en bucle si el problema es otro (sin internet, etc.)
    const ultima = Number(sessionStorage.getItem('bea_recarga_version') || 0)
    if (Date.now() - ultima < 60000) return false
    sessionStorage.setItem('bea_recarga_version', String(Date.now()))
  } catch { /* sin almacenamiento */ }
  setTimeout(() => window.location.reload(), 1200)
  return true
}

export async function cargarModulo(importar) {
  try {
    return await importar()
  } catch (err) {
    if (esVersionVieja(err)) {
      recargarPorVersion()
      throw new Error('La app se actualizó mientras tenías la página abierta. Se va a recargar; vuelve a intentarlo en unos segundos.')
    }
    throw err
  }
}

export const cargarExcelJS = () => cargarModulo(() => import('exceljs')).then(m => m.default)
export const cargarJSZip = () => cargarModulo(() => import('jszip')).then(m => m.default)

/** Descarga un archivo generado en el navegador (el enlace se agrega a la página: así funciona en todos los navegadores). */
export function bajarArchivo(buffer, nombre, tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const url = URL.createObjectURL(new Blob([buffer], { type: tipo }))
  const a = document.createElement('a')
  a.href = url; a.download = nombre; a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 10000)
}
