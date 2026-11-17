// Ajustes documentados a la lectura de un libro, ANTES de conciliar.
//
// Cada ajuste corrige un error de captura del Excel que se comprobó con otro documento (el PDF
// que se le mandó al cliente, el indicador del cliente, la estructura del propio libro). La
// conciliación sigue siendo al peso: si el ajuste no hace cuadrar el libro, el proyecto no se carga.
//
// Formato del archivo (JSON), por clave de proyecto (la de claveDeArchivo: "586", "564-chalco"…):
// {
//   "586": {
//     "desmarcar": ["5.01", "5.02"],          // conceptos marcados que nunca se cobraron (todas las hojas)
//     "quitar_esta": ["3.03"],                // marca de "esta estimación" duplicada (todas las hojas)
//     "encabezado": { "anticipo": 0 },        // valores del encabezado mal capturados (todas las hojas)
//     "disciplina_normal": ["9B"],            // disciplina marcada como finiquito que se cobra como normal
//     "acumulado_excel": "acumulado_anterior",// el acumulado bueno es otro campo del encabezado (última hoja)
//     "acumulado_excel_valor": 883350,        // acumulado comprobado con otra fuente (última hoja)
//     "quitar_conceptos": ["3a.11"],          // renglones vacíos de la plantilla
//     "evidencia": "texto que queda en la nota del proyecto"
//   }
// }
import fs from 'fs'

export function leerAjustes(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return {}
  return JSON.parse(fs.readFileSync(ruta, 'utf8'))
}

export function aplicarAjustes(libroOriginal, ajuste) {
  if (!ajuste) return libroOriginal
  const libro = structuredClone(libroOriginal)
  const desmarcar = new Set((ajuste.desmarcar || []).map(String))
  const quitarEsta = new Set((ajuste.quitar_esta || []).map(String))
  const normales = new Set((ajuste.disciplina_normal || []).map(String))
  const quitar = new Set((ajuste.quitar_conceptos || []).map(String))
  for (const m of libro.meses) {
    // renglones basura de la plantilla (sin descripción ni monto)
    if (quitar.size) m.disciplinas.forEach(d => { d.conceptos = d.conceptos.filter(c => !quitar.has(c.clave)) })
    if (ajuste.encabezado) Object.assign(m.encabezado, ajuste.encabezado)
    for (const d of m.disciplinas) {
      if (normales.has(d.clave)) {
        d.finiquito = false
        d.conceptos.forEach(c => { c.finiquito = false })
      }
      for (const c of d.conceptos) {
        if (desmarcar.has(c.clave)) { c.marca_anterior = 0; c.marca_esta = 0 }
        if (quitarEsta.has(c.clave)) c.marca_esta = 0
      }
    }
  }
  if (ajuste.acumulado_excel) {
    const h = libro.meses.at(-1).encabezado
    h.acumulado_global = h[ajuste.acumulado_excel]
  }
  // acumulado comprobado con otra fuente cuando el encabezado del libro está mal encadenado
  if (ajuste.acumulado_excel_valor != null) libro.meses.at(-1).encabezado.acumulado_global = ajuste.acumulado_excel_valor
  return libro
}
