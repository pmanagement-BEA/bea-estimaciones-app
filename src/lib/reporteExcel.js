// Reporte mensual en el formato BEA RC-OP-01 "REPORTE MENSUAL / SCORECARD DEL PROYECTO"
// (mismo acomodo que el libro del reporte: columnas A–M, Arial 10, encabezados grises). ExcelJS se carga solo al usarlo.
import { cargarLogoBea } from './estimacionExcel.js'

export const AREAS_REPORTE = [
  ['Consultoría', 'CONSULTORÍA'],
  ['Commissioning', 'COMISIONAMIENTO'],
  ['Modelación', 'MODELADO ENERGÉTICO'],
]
export const ETIQUETA_AREA = { 'Consultoría': 'Consultoría', 'Commissioning': 'Comisionamiento', 'Modelación': 'Modelado energético' }

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

export function mesReporte(periodFrom) {
  if (!periodFrom) return ''
  const [y, m] = periodFrom.split('-').map(Number)
  return `${MESES[m - 1]} ${y}`
}

const fechaExcel = d => (d ? new Date(d.slice(0, 10) + 'T12:00:00') : null)

/** Acciones realizadas agrupadas por área, en el orden del formato. Las que no traen área van a Consultoría. */
export function accionesPorArea(acciones) {
  return AREAS_REPORTE.map(([area, titulo]) => ({
    area, titulo,
    filas: (acciones || []).filter(a => (a.area || 'Consultoría') === area && ((a.task || '').trim() || (a.descripcion || '').trim())),
  })).filter(g => g.filas.length)
}

/** Cada línea de la descripción es una acción (como en el reporte); si no hay líneas, la tarea. */
function renglonesAccion(a) {
  const tarea = (a.task || '').trim()
  const lineas = (a.descripcion || '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lineas.length) return [tarea]
  return lineas.map(l => (tarea ? `${tarea}: ${l}` : l))
}

/**
 * datos: { proyecto, cliente, numero, periodFrom, rpt, equipo: { lider, cx, me } }
 */
export async function libroReporte(ExcelJS, datos, logo) {
  const { rpt = {}, equipo = {} } = datos
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(mesReporte(datos.periodFrom) || 'Reporte', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 1, header: 0, footer: 0 } },
  })
  ws.columns = [4.5, 9.88, 20.63, 5.63, 6.38, 5.38, 7, 29.63, 15.63, 11.13, 7.88, 8.38, 11.5].map(width => ({ width }))

  const t = { style: 'thin', color: { argb: 'FF000000' } }
  const todo = { top: t, left: t, bottom: t, right: t }
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const arial = (size = 10, bold = false, extra = {}) => ({ name: 'Arial', size, bold, ...extra })
  const GRIS_SECCION = 'FF999999', GRIS_ETIQUETA = 'FFEFEFEF', GRIS_COLUMNA = 'FFD9D9D9', GRIS_EQUIPO = 'FFD8D8D8', GRIS_CAPTURA = 'FFF2F2F2'

  const bordes = (r1, c1, r2, c2) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = todo }
  const poner = (rango, value, { font = arial(), fill, numFmt, align = {} } = {}) => {
    const [a, b] = rango.split(':')
    if (b) ws.mergeCells(rango)
    const c = ws.getCell(a)
    c.value = value
    c.font = font
    if (fill) c.fill = fill
    if (numFmt) c.numFmt = numFmt
    c.alignment = { vertical: 'middle', wrapText: true, ...align }
    const ini = ws.getCell(a), fin = ws.getCell(b || a)
    bordes(ini.row, ini.col, fin.row, fin.col)
    return c
  }
  const etiqueta = (rango, texto) => poner(rango, texto, { font: arial(10, true), fill: relleno(GRIS_ETIQUETA) })
  const seccion = (r, texto, alto = 24.75) => { ws.getRow(r).height = alto; poner(`A${r}:M${r}`, texto, { font: arial(10, true), fill: relleno(GRIS_SECCION), align: { horizontal: 'center' } }) }
  const numero = (r, n) => poner(`A${r}`, n, { font: arial(10, true), align: { horizontal: 'center' } })
  // Alto del renglón según el texto (aprox. caracteres por línea del ancho combinado)
  const alto = (r, texto, porLinea, minimo = 22.5) => {
    const lineas = String(texto || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / porLinea)), 0)
    ws.getRow(r).height = Math.max(minimo, lineas * 13 + 6)
  }

  // ── Título y logo ────────────────────────────────────────────────────────
  ws.getRow(1).height = 36.75; ws.getRow(2).height = 20
  poner('A1:M2', 'REPORTE MENSUAL /\nSCORECARD DEL PROYECTO', { font: arial(12, true), align: { horizontal: 'center' } })
  if (logo) {
    const id = wb.addImage({ buffer: logo, extension: 'png' })
    ws.addImage(id, { tl: { col: 9.05, row: 0.15 }, ext: { width: 230, height: 60 } })
  }

  // ── Datos del proyecto ───────────────────────────────────────────────────
  ws.getRow(3).height = 27
  poner('A3:M3', 'DATOS DEL PROYECTO', { font: arial(10, true), fill: relleno(GRIS_SECCION), align: { horizontal: 'center' } })
  ;[[4, 28.5], [5, 30.75], [6, 27], [7, 33]].forEach(([r, h]) => { ws.getRow(r).height = h })
  const fechaFmt = { numFmt: 'd/m/yyyy', align: { horizontal: 'left' } }
  const mesFmt = { numFmt: '[$-80A]mmmm yyyy', align: { horizontal: 'left' } }
  etiqueta('A4:B4', 'PROYECTO:'); poner('C4:D4', datos.proyecto || '')
  etiqueta('E4:G4', 'FASE: '); poner('H4:I4', (rpt.fase_texto || '').toUpperCase())
  etiqueta('J4:L4', 'ESTADO DE PROYECTO: '); poner('M4', (rpt.estado_proyecto || '').toUpperCase())
  etiqueta('A5:B5', 'CLIENTE:'); poner('C5:D5', datos.cliente || '')
  etiqueta('E5:G6', '% GLOBAL DE AVANCE DOCUMENTAL')
  const pct = rpt.avance_documental != null && rpt.avance_documental !== '' ? Number(rpt.avance_documental) / 100 : null
  poner('H5:I6', pct, { numFmt: '0.00%', align: { horizontal: 'left' } })
  etiqueta('J5:L5', 'INICIO DE FASE:'); poner('M5', fechaExcel(rpt.inicio_fase) || 'TBD', mesFmt)
  etiqueta('A6:B6', 'INICIO DE CONTRATO:'); poner('C6:D6', fechaExcel(rpt.inicio_contrato) || 'TBD', fechaFmt)
  etiqueta('J6:L6', 'FINALIZACIÓN DE FASE:'); poner('M6', fechaExcel(rpt.fin_fase) || 'TBD', mesFmt)
  etiqueta('A7:B7', 'FINALIZACIÓN DE CONTRATO:'); poner('C7:D7', fechaExcel(rpt.fin_contrato) || 'TBD', fechaFmt)
  etiqueta('E7:G7', 'FECHA:'); poner('H7:M7', new Date(), fechaFmt)

  // ── Distribución ─────────────────────────────────────────────────────────
  seccion(8, 'DISTRIBUCIÓN DEL PROYECTO')
  ;[9, 10, 11, 12].forEach(r => { ws.getRow(r).height = 25.5 })
  poner('A9:H9', 'BEA', { font: arial(10, true), fill: relleno(GRIS_EQUIPO), align: { horizontal: 'center' } })
  poner('I9:M9', (datos.cliente || 'CLIENTE').toUpperCase(), { font: arial(10, true), fill: relleno(GRIS_EQUIPO), align: { horizontal: 'center' } })
  etiqueta('A10:B10', 'LÍDER DE PROYECTO:'); poner('C10:H10', (equipo.lider || '').toUpperCase())
  etiqueta('A11:B11', 'AUTORIDAD CX:'); poner('C11:H11', (equipo.cx || '').toUpperCase())
  etiqueta('A12:B12', 'MODELACIÓN ENERGÉTICA'); poner('C12:H12', (equipo.me || '').toUpperCase())
  etiqueta('I10:I12', 'CLIENTE RESPONSABLE:'); poner('J10:M12', (rpt.cliente_responsable || '').toUpperCase())

  // ── Acciones realizadas ──────────────────────────────────────────────────
  let r = 13
  seccion(r++, 'ACCIONES REALIZADAS EN EL MES')
  const encabezadoAcciones = () => {
    ws.getRow(r).height = 23.25
    poner(`A${r}`, 'Nº', { fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
    poner(`B${r}:L${r}`, 'ACCIÓN', { fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
    poner(`M${r}`, 'FECHA', { fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
    r++
  }
  encabezadoAcciones()
  const grupos = accionesPorArea(rpt.acciones_realizadas)
  const variasAreas = grupos.length > 1
  let n = 0
  for (const g of grupos) {
    if (variasAreas) { ws.getRow(r).height = 20; poner(`A${r}:M${r}`, g.titulo, { font: arial(10, true), fill: relleno(GRIS_ETIQUETA), align: { horizontal: 'center' } }); r++ }
    for (const a of g.filas) for (const texto of renglonesAccion(a)) {
      numero(r, ++n); poner(`B${r}:L${r}`, texto); poner(`M${r}`, fechaExcel(a.fecha), { numFmt: 'dd/mm/yy', align: { horizontal: 'right' } })
      alto(r, texto, 115, 23.25); r++
    }
  }
  while (n < 3) { numero(r, ++n); poner(`B${r}:L${r}`, ''); poner(`M${r}`, ''); ws.getRow(r).height = 22.5; r++ }

  // ── Acciones pendientes ──────────────────────────────────────────────────
  seccion(r++, 'ACCIONES PENDIENTES', 28.5)
  const pend = (rpt.acciones_pendientes || []).filter(a => (a.accion || '').trim())
  const filasPend = Math.max(2, pend.length)
  for (let i = 0; i < filasPend; i++) {
    const a = pend[i]
    const texto = a ? a.accion + ((a.responsable || 'BEA') === 'Cliente' ? ' (Cliente)' : '') : ''
    numero(r, i + 1); poner(`B${r}:L${r}`, texto)
    poner(`M${r}`, a ? (fechaExcel(a.fecha) || 'TBD') : '', { numFmt: 'dd/mm/yy', align: { horizontal: 'right' } })
    alto(r, texto, 115); r++
  }

  // ── Información pendiente ────────────────────────────────────────────────
  seccion(r++, 'INFORMACIÓN PENDIENTE', 28.5)
  const info = (rpt.informacion_pendiente || []).filter(a => (a.texto || '').trim())
  const filasInfo = Math.max(4, info.length)
  const r0 = r
  for (let i = 0; i < filasInfo; i++) {
    const a = info[i]
    const texto = a ? a.texto + ((a.responsable || 'BEA') === 'Cliente' ? ' (Cliente)' : '') : ''
    numero(r, i + 1); poner(`B${r}:J${r}`, texto, { fill: relleno(GRIS_CAPTURA), align: { horizontal: 'left' } })
    alto(r, texto, 90); r++
  }
  poner(`K${r0}:M${r - 1}`, (rpt.nota_info_pendiente || '').trim(), { font: arial(9), align: { horizontal: 'left' } })

  // ── Riesgos ──────────────────────────────────────────────────────────────
  seccion(r++, 'RIESGOS ACTUALES', 36)
  ws.getRow(r).height = 42.75
  poner(`A${r}`, 'Nº', { fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
  poner(`B${r}:J${r}`, 'RIESGOS DERIVADOS DE LA FASE ACTUAL', { fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
  poner(`K${r}:M${r}`, 'PRERREQUISITOS/\nCRÉDITOS EN RIESGO DE INCUMPLIMIENTO', { font: arial(8), fill: relleno(GRIS_COLUMNA), align: { horizontal: 'center' } })
  r++
  const riesgos = rpt.no_riesgos ? [] : (rpt.riesgos || []).filter(a => (a.riesgo || '').trim())
  if (!riesgos.length) {
    numero(r, 1); poner(`B${r}:J${r}`, 'No hay riesgos actuales.', { font: arial(10, true) }); poner(`K${r}:M${r}`, ''); ws.getRow(r).height = 22.5; r++
  }
  riesgos.forEach((a, i) => {
    numero(r, i + 1)
    poner(`B${r}:J${r}`, a.riesgo, { font: arial(10, true, { color: { argb: 'FFC00000' } }), align: { horizontal: 'left' } })
    poner(`K${r}:M${r}`, a.creditos || '', { align: { horizontal: 'left' } })
    ws.getRow(r).height = Math.max(40, Math.ceil(String(a.riesgo).length / 85) * 13 + 8, String(a.creditos || '').split(/\n|\//).length * 13 + 8)
    r++
  })

  // ── Entregables ──────────────────────────────────────────────────────────
  r++
  seccion(r++, 'ENTREGABLES SIGNIFICATIVOS BEA', 15.75)
  const ent = (rpt.entregables || []).filter(a => (a.texto || '').trim())
  for (let i = 0; i < Math.max(6, ent.length); i++) {
    numero(r, i + 1); poner(`B${r}:M${r}`, ent[i]?.texto || '', { align: { horizontal: 'left' } }); alto(r, ent[i]?.texto, 125, 15); r++
  }

  // ── Anexos ───────────────────────────────────────────────────────────────
  r++
  seccion(r++, 'ANEXOS', 17.25)
  numero(r, 1); poner(`B${r}:M${r}`, rpt.no_anexos ? 'Sin anexos.' : '', { align: { horizontal: 'left' } }); ws.getRow(r).height = 15; r++

  // ── Resumen del proyecto ─────────────────────────────────────────────────
  r++
  seccion(r++, 'RESUMEN DEL PROYECTO', 15.75)
  const res = (rpt.resumen_proyecto || []).filter(a => (a.hito || '').trim())
  for (let i = 0; i < Math.max(7, res.length); i++) {
    const a = res[i]
    numero(r, i + 1); poner(`B${r}:L${r}`, a?.hito || '', { align: { horizontal: 'left' } })
    poner(`M${r}`, a ? fechaExcel(a.fecha) : '', { numFmt: 'd/m/yyyy', align: { horizontal: 'right' } })
    alto(r, a?.hito, 115, 15.75); r++
  }

  ws.pageSetup.printArea = `A1:M${r - 1}`
  return wb
}

export async function descargarReporteExcel(datos) {
  const ExcelJS = (await import('exceljs')).default
  let logo = null
  try { logo = await cargarLogoBea() } catch { /* sin logo, el resto sale igual */ }
  const wb = await libroReporte(ExcelJS, datos, logo)
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  const codigo = (datos.proyecto || '').split(/[-_]/)[0]
  a.href = url; a.download = `${codigo}-RC-OP-01 Reporte mensual ${mesReporte(datos.periodFrom)}.xlsx`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
