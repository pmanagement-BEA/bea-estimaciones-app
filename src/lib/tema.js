// Modo claro / oscuro: se guarda por persona en este navegador.
const CLAVE = 'bea_tema'
export function temaGuardado() {
  try { return localStorage.getItem(CLAVE) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}
export function aplicarTema(t) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(CLAVE, t) } catch { /* sin storage */ }
}
