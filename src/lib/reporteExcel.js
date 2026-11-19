// Reporte mensual en el formato BEA RC-OP-01 "REPORTE MENSUAL / SCORECARD DEL PROYECTO"
// (mismo acomodo que el libro del reporte: columnas A–M, Arial 10, encabezados grises). ExcelJS se carga solo al usarlo.
import { cargarLogoBea } from './estimacionExcel.js'
import { cargarExcelJS, bajarArchivo } from './cargarModulo.js'

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
 * Libro en el formato RC-OP-01 REV 2 "REPORTE MENSUAL / CHECKLIST DEL PROYECTO"
 * (copiado de la plantilla RC-OP-01 REPORTE DE SEGUIMIENTO MENSUAL. REV 2.xlsx).
 * datos: { proyecto, cliente, numero, periodFrom, rpt, equipo: { lider, cx, me } }
 */
export async function libroReporte(ExcelJS, datos, logo, logoCliente = null) {
  const { rpt = {}, equipo = {} } = datos
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(mesReporte(datos.periodFrom) || 'Reporte', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0, footer: 0 } },
  })
  ws.columns = [4.5, 9.88, 20.63, 5.63, 6.38, 5.38, 7, 29.63, 15.63, 11.13, 7.88, 8.38, 11.63].map(width => ({ width }))

  const negro = { argb: 'FF000000' }
  const fino = { style: 'thin', color: negro }
  const grueso = { style: 'medium', color: negro }
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const arial = (size = 10, bold = false, color) => ({ name: 'Arial', size, bold, color: color ? { argb: color } : { theme: 1 } })
  const ROJO = 'FFCC0000'
  const GRIS_SECCION = 'FF999999', GRIS_ETIQUETA = 'FFEFEFEF', GRIS_COLUMNA = 'FFD9D9D9', GRIS_EQUIPO = 'FFD8D8D8'

  const poner = (rango, value, { font = arial(), fill, numFmt, h, v = 'middle' } = {}) => {
    const [a, b] = rango.split(':')
    if (b) ws.mergeCells(rango)
    const c = ws.getCell(a)
    c.value = value
    c.font = font
    if (fill) c.fill = fill
    if (numFmt) c.numFmt = numFmt
    c.alignment = { vertical: v, wrapText: true, ...(h ? { horizontal: h } : {}) }
    const ini = ws.getCell(a), fin = ws.getCell(b || a)
    for (let y = ini.row; y <= fin.row; y++) for (let x = ini.col; x <= fin.col; x++) ws.getCell(y, x).border = { top: fino, left: fino, bottom: fino, right: fino }
    return c
  }
  /** Marco grueso de una sección (A:M), como en la plantilla */
  const marco = (r1, r2) => {
    for (let y = r1; y <= r2; y++) for (let x = 1; x <= 13; x++) {
      const c = ws.getCell(y, x)
      const bo = { ...(c.border || {}) }
      if (y === r1) bo.top = grueso
      if (y === r2) bo.bottom = grueso
      if (x === 1) bo.left = grueso
      if (x === 13) bo.right = grueso
      c.border = bo
    }
  }
  const etiqueta = (rango, texto) => poner(rango, texto, { font: arial(10, true), fill: relleno(GRIS_ETIQUETA) })
  const seccion = (r, texto, alto) => { ws.getRow(r).height = alto; poner(`A${r}:M${r}`, texto, { font: arial(10, true), fill: relleno(GRIS_SECCION), h: 'center' }) }
  const numero = (r, n) => poner(`A${r}`, n, { font: arial(10, true), h: 'center' })
  const alto = (r, texto, porLinea, minimo) => {
    const lineas = String(texto || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / porLinea)), 0)
    ws.getRow(r).height = lineas > 1 ? Math.max(minimo, lineas * 13 + 6) : minimo
  }

  // ── Título y logo ────────────────────────────────────────────────────────
  ws.getRow(1).height = 36.75
  ws.mergeCells('A1:M2')
  const t = ws.getCell('A1')
  t.value = 'REPORTE MENSUAL / CHECKLIST DEL PROYECTO'
  t.font = arial(12, true)
  t.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  if (logo) {
    const id = wb.addImage({ buffer: logo, extension: 'png' })
    ws.addImage(id, { tl: { nativeCol: 9, nativeColOff: 0, nativeRow: 0, nativeRowOff: 47625 }, ext: { width: 265, height: 68 }, editAs: 'oneCell' })
  }
  if (logoCliente?.buffer) {
    // Arriba a la izquierda, del mismo tamaño que el de BEA (265×68 px como máximo, sin deformarse)
    const escala = Math.min(265 / (logoCliente.width || 265), 68 / (logoCliente.height || 68))
    const id = wb.addImage({ buffer: logoCliente.buffer, extension: logoCliente.extension === 'jpg' ? 'jpeg' : logoCliente.extension })
    ws.addImage(id, { tl: { nativeCol: 1, nativeColOff: 47625, nativeRow: 0, nativeRowOff: 47625 },
      ext: { width: Math.round((logoCliente.width || 265) * escala), height: Math.round((logoCliente.height || 68) * escala) }, editAs: 'oneCell' })
  }

  // ── Datos del proyecto ───────────────────────────────────────────────────
  ws.getRow(3).height = 27
  poner('A3:M3', 'DATOS DEL PROYECTO', { font: arial(10, true), fill: relleno(GRIS_SECCION), h: 'center' })
  ;[4, 5, 6, 7].forEach(r => { ws.getRow(r).height = 22.5 })
  const fechaFmt = { numFmt: 'd/m/yyyy', h: 'left' }
  etiqueta('A4:B4', 'PROYECTO:'); poner('C4:D4', datos.proyecto || '')
  etiqueta('E4:G4', 'FASE: '); poner('H4:I4', rpt.fase_texto || '')
  etiqueta('J4:L4', 'ESTADO DE PROYECTO: '); poner('M4', (rpt.estado_proyecto || '').toUpperCase(), { fill: relleno('FFFFFFFF') })
  etiqueta('A5:B5', 'CLIENTE:'); poner('C5:D5', datos.cliente || '')
  etiqueta('E5:G6', '% GLOBAL DE AVANCE DOCUMENTAL')
  const pct = rpt.avance_documental != null && rpt.avance_documental !== '' ? Number(rpt.avance_documental) / 100 : null
  poner('H5:I6', pct, { numFmt: '0.00%', h: 'left' })
  etiqueta('J5:L5', 'INICIO DE FASE:'); poner('M5', fechaExcel(rpt.inicio_fase), fechaFmt)
  etiqueta('A6:B6', 'INICIO DE CONTRATO:'); poner('C6:D6', fechaExcel(rpt.inicio_contrato), fechaFmt)
  etiqueta('J6:L6', 'FINALIZACIÓN DE FASE:'); poner('M6', fechaExcel(rpt.fin_fase), fechaFmt)
  etiqueta('A7:B7', 'FINALIZACIÓN DE CONTRATO:'); poner('C7:D7', fechaExcel(rpt.fin_contrato), fechaFmt)
  etiqueta('E7:G7', 'FECHA:'); poner('H7:M7', new Date(), fechaFmt)
  marco(3, 7)

  // ── Distribución ─────────────────────────────────────────────────────────
  seccion(8, 'DISTRIBUCIÓN DEL PROYECTO', 24.75)
  ws.getRow(9).height = 25.5
  ;[10, 11, 12].forEach(r => { ws.getRow(r).height = 22.5 })
  poner('A9:H9', 'BEA', { font: arial(10, true), fill: relleno(GRIS_EQUIPO), h: 'center' })
  poner('I9:M9', 'CLIENTE', { font: arial(10, true), fill: relleno(GRIS_EQUIPO), h: 'center' })
  etiqueta('A10:B10', 'LÍDER DE PROYECTO:'); poner('C10:H10', equipo.lider || '')
  etiqueta('A11:B11', 'AUTORIDAD CX:'); poner('C11:H11', equipo.cx || '')
  etiqueta('A12:B12', 'MODELACIÓN ENERGÉTICA'); poner('C12:H12', equipo.me || '')
  etiqueta('I10:I12', 'CLIENTE RESPONSABLE:'); poner('J10:M12', rpt.cliente_responsable || '')
  marco(8, 12)

  // ── Acciones realizadas: una tabla por área ──────────────────────────────
  let r = 13
  seccion(r++, 'ACCIONES REALIZADAS EN EL MES', 24.75)
  const porArea = AREAS_REPORTE.map(([area, titulo]) => ({
    titulo,
    filas: (rpt.acciones_realizadas || []).filter(a => (a.area || 'Consultoría') === area && ((a.task || '').trim() || (a.descripcion || '').trim())),
  }))
  for (const g of porArea) {
    ws.getRow(r).height = 23.25
    poner(`A${r}`, 'Nº', { fill: relleno(GRIS_COLUMNA), h: 'center' })
    poner(`B${r}:L${r}`, g.titulo, { fill: relleno(GRIS_COLUMNA), h: 'center' })
    poner(`M${r}`, 'FECHA', { fill: relleno(GRIS_COLUMNA), h: 'center' })
    r++
    const renglones = g.filas.flatMap(a => renglonesAccion(a).map(texto => ({ texto, fecha: a.fecha })))
    if (!renglones.length) renglones.push({ texto: 'NA', fecha: '' })
    renglones.forEach((x, i) => {
      numero(r, i + 1); poner(`B${r}:L${r}`, x.texto); poner(`M${r}`, fechaExcel(x.fecha), { numFmt: 'd/m/yyyy', h: 'center' })
      alto(r, x.texto, 110, 22.5); r++
    })
  }
  marco(13, r - 1)

  // ── Acciones pendientes ──────────────────────────────────────────────────
  let r0 = r
  seccion(r++, 'ACCIONES PENDIENTES', 28.5)
  const pend = (rpt.acciones_pendientes || []).filter(a => (a.accion || '').trim())
  const filasPend = pend.length ? pend : [null]
  filasPend.forEach((a, i) => {
    const texto = !a ? '' : (a.responsable || 'BEA') === 'Cliente' && datos.cliente && !/^por parte de/i.test(a.accion.trim()) ? `Por parte de ${datos.cliente}, ${a.accion.charAt(0).toLowerCase()}${a.accion.slice(1)}` : a.accion
    numero(r, i + 1); poner(`B${r}:L${r}`, texto, { font: arial(10, true) })
    poner(`M${r}`, a ? (fechaExcel(a.fecha) || 'TBD') : '', { numFmt: 'd/m/yyyy', h: 'center' })
    alto(r, texto, 110, 22.5); r++
  })
  marco(r0, r - 1)

  // ── Información pendiente ────────────────────────────────────────────────
  r0 = r
  seccion(r++, 'INFORMACIÓN PENDIENTE', 28.5)
  const info = (rpt.informacion_pendiente || []).filter(a => (a.texto || '').trim())
  const filasInfo = Math.max(4, info.length)
  const ri = r
  for (let i = 0; i < filasInfo; i++) {
    const a = info[i]
    const texto = a ? a.texto : ''
    numero(r, i + 1); poner(`B${r}:J${r}`, texto, { font: arial(10, false, ROJO), h: 'left' })
    alto(r, texto, 85, 22.5); r++
  }
  poner(`K${ri}:M${r - 1}`, (rpt.nota_info_pendiente || '').trim(), { font: arial(8, false, 'FF999999'), h: 'center' })
  marco(r0, r - 1)

  // ── Riesgos ──────────────────────────────────────────────────────────────
  r0 = r
  seccion(r++, 'RIESGOS ACTUALES', 27.75)
  ws.getRow(r).height = 24.75
  poner(`A${r}`, 'Nº', { fill: relleno(GRIS_COLUMNA), h: 'center' })
  poner(`B${r}:J${r}`, 'RIESGOS DERIVADOS DE LA FASE ACTUAL', { fill: relleno(GRIS_COLUMNA), h: 'center' })
  poner(`K${r}:M${r}`, 'PRERREQUISITOS/\nCRÉDITOS EN INCUMPLIMIENTO', { font: arial(8), fill: relleno(GRIS_COLUMNA), h: 'center' })
  r++
  const riesgos = rpt.no_riesgos ? [] : (rpt.riesgos || []).filter(a => (a.riesgo || '').trim())
  const filasRiesgo = riesgos.length ? riesgos : [{ riesgo: rpt.no_riesgos ? 'No hay riesgos actuales.' : '', creditos: '' }]
  filasRiesgo.forEach((a, i) => {
    numero(r, i + 1)
    poner(`B${r}:J${r}`, a.riesgo, { font: arial(10, true, ROJO) })
    poner(`K${r}:M${r}`, a.creditos || '')
    ws.getRow(r).height = Math.max(22.5, Math.ceil(String(a.riesgo).length / 80) * 13 + 8, Math.ceil(String(a.creditos || '').length / 25) * 13 + 8)
    r++
  })
  marco(r0, r - 1)

  // ── Entregables ──────────────────────────────────────────────────────────
  r0 = r
  seccion(r++, 'ENTREGABLES SIGNIFICATIVOS BEA/ANEXOS', 22.5)
  const ent = (rpt.entregables || []).filter(a => (a.texto || '').trim())
  for (let i = 0; i < Math.max(2, ent.length); i++) {
    numero(r, i + 1); poner(`B${r}:M${r}`, ent[i]?.texto || '', { h: 'left' }); alto(r, ent[i]?.texto, 120, 22.5); r++
  }
  marco(r0, r - 1)

  // ── Resumen del proyecto ─────────────────────────────────────────────────
  r++
  r0 = r
  seccion(r++, 'RESUMEN DEL PROYECTO', 22.5)
  const res = (rpt.resumen_proyecto || []).filter(a => (a.hito || '').trim())
  for (let i = 0; i < Math.max(4, res.length); i++) {
    const a = res[i]
    numero(r, i + 1); poner(`B${r}:L${r}`, a?.hito || '', { font: arial(10, false, 'FF000000'), h: 'left' })
    poner(`M${r}`, a ? fechaExcel(a.fecha) : '', { numFmt: 'd/m/yyyy', h: 'center' })
    alto(r, a?.hito, 110, 22.5); r++
  }
  marco(r0, r - 1)

  ws.pageSetup.printArea = `A1:M${r - 1}`
  return wb
}

export async function descargarReporteExcel(datos) {
  const ExcelJS = await cargarExcelJS()
  let logo = null
  try { logo = await cargarLogoBea() } catch { /* sin logo, el resto sale igual */ }
  const wb = await libroReporte(ExcelJS, datos, logo, datos.logoCliente)
  const buf = await wb.xlsx.writeBuffer()
  const codigo = (datos.proyecto || '').split(/[-_]/)[0]
  bajarArchivo(buf, `${codigo}-RC-OP-01 Reporte mensual ${mesReporte(datos.periodFrom)}.xlsx`)
}
