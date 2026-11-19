// Estimación en el formato BEA RC-OP-11 "ESTIMACIÓN DE AVANCE" (el mismo de los libros de cada proyecto).
// Columnas como en el libro: B clave · C:H concepto · I entregable · K monto · L:M anterior (% y $) ·
// N:O esta estimación (% y $) · P acumulado · Q por estimar. Los importes de cada renglón quedan con fórmulas.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export const MONEDA = '"$"#,##0.00;[Red]"$"#,##0.00'
const VERDE_DISCIPLINA = 'FFEAF1DD'
const VERDE_FASE = 'FF76923C'
const GRIS = 'FFD8D8D8'
const CAPTURA = 'FFFFF2DC'

export async function cargarLogoBea() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const r = await fetch(`${base}formatos/logo-bea.png`)
  if (!r.ok) throw new Error('No se encontró el logo de BEA')
  return r.arrayBuffer()
}

/** "Del 01 al 31 de octubre de 2026" (o "Del 15 de septiembre al 10 de octubre de 2026") */
export function textoPeriodo(desde, hasta) {
  if (!desde || !hasta) return ''
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const dd = n => String(n).padStart(2, '0')
  if (y1 === y2 && m1 === m2) return `Del ${dd(d1)} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
  if (y1 === y2) return `Del ${dd(d1)} de ${MESES[m1 - 1]} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
  return `Del ${dd(d1)} de ${MESES[m1 - 1]} de ${y1} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
}

const fechaExcel = d => (d ? new Date(d.slice(0, 10) + 'T12:00:00') : null)
const pctTxt = v => `${Math.round(v * 100) / 100}%`

/** Arma el libro (sin descargarlo). hoja = armarHoja(...) */
export async function libroEstimacion(ExcelJS, hoja, logo) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Estimación ${hoja.numero}`, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.08, header: 0, footer: 0 } },
  })
  ws.columns = [7.11, 9.5, 16.67, 16.67, 16.67, 16.67, 14.67, 14.67, 18, 12, 18, 9, 16, 9, 16, 22, 22].map(width => ({ width }))
  ws.getColumn(10).hidden = true // "PRESUPUESTO OCULTAR" del libro

  const t = { style: 'thin', color: { argb: 'FF000000' } }
  const h = { style: 'hair', color: { argb: 'FF7F7F7F' } }
  const todo = { top: t, left: t, bottom: t, right: t }
  const fila = { top: h, left: t, bottom: h, right: t }
  const mont = (size = 12, bold = false, extra = {}) => ({ name: 'Montserrat', size, bold, ...extra })
  const goth = (size = 11, extra = {}) => ({ name: 'Gotham Book', size, ...extra })
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const celda = (ref, value, { font, fill, numFmt, align, border = todo } = {}) => {
    const c = ws.getCell(ref)
    c.value = value
    if (font) c.font = font
    if (fill) c.fill = fill
    if (numFmt) c.numFmt = numFmt
    c.alignment = { vertical: 'middle', wrapText: true, ...(align || {}) }
    if (border) c.border = border
    return c
  }
  const unir = (rango, ...args) => { ws.mergeCells(rango); return celda(rango.split(':')[0], ...args) }
  const bordeRango = (r1, c1, r2, c2, border = todo) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = border }

  // ── Encabezado ───────────────────────────────────────────────────────────
  ws.getRow(1).height = 8
  ws.getRow(2).height = 33
  ;[3, 4, 5, 6].forEach(r => { ws.getRow(r).height = 19.5 })
  bordeRango(2, 2, 6, 5)
  ws.mergeCells('B2:E6')
  if (logo) {
    const id = wb.addImage({ buffer: logo, extension: 'png' })
    ws.addImage(id, { tl: { col: 1.25, row: 1.6 }, ext: { width: 300, height: 78 } })
  }
  unir('F2:O2', 'ESTIMACIÓN DE AVANCE', { font: mont(16), align: { horizontal: 'center' } })
  celda('P2', 'RC-OP-11 Rev.3-06/22', { font: goth(10) })
  celda('Q2', new Date(), { font: goth(10), numFmt: '[$-80A]d" de "mmmm" de "yyyy', align: { horizontal: 'left' } })
  unir('F3:K4', `Proyecto: ${hoja.proyecto || ''}`, { font: goth(11), align: { horizontal: 'center' } })
  unir('L3:O4', `Cliente: ${hoja.cliente || ''}`, { font: goth(11), align: { horizontal: 'center' } })
  celda('P3', 'FECHA DE INICIO:', { font: goth(10) })
  celda('Q3', fechaExcel(hoja.inicio) || 'TBD', { font: goth(10), numFmt: '[$-80A]mmmm yyyy', align: { horizontal: 'right' } })
  celda('P4', 'FECHA DE TERMINACIÓN:', { font: goth(10) })
  celda('Q4', fechaExcel(hoja.fin) || 'TBD', { font: goth(10), numFmt: '[$-80A]mmmm yyyy', align: { horizontal: 'right' } })
  unir('F5:K6', `Ubicación: ${hoja.ubicacion || ''}`, { font: goth(11), align: { horizontal: 'center' } })
  unir('L5:O6', `TIPO DE MONEDA: ${hoja.moneda || 'MXN'}`, { font: goth(11), align: { horizontal: 'center' } })
  unir('P5:Q6', `PERIODO DE ESTIMACIÓN:\n${textoPeriodo(hoja.periodFrom, hoja.periodTo)}`, { font: goth(10), align: { horizontal: 'center' } })
  bordeRango(2, 6, 6, 17)

  // ── Resumen de importes ──────────────────────────────────────────────────
  const tot = hoja.totales
  const estimablePct = 100 - (hoja.anticipoPct || 0) - (hoja.finiquitoPct || 0)
  const resumen = [
    [`IMPORTE TOTAL`, tot.importe, 'ACUMULADO ANTERIOR', tot.acumAnterior, '% AVANCE ESTA ESTIMACIÓN', tot.avanceEsta / 100],
    [`ANTICIPO (${pctTxt(hoja.anticipoPct || 0)})`, tot.anticipo > 0.005 ? tot.anticipo : 'NA', 'ESTIMACIÓN ACTUAL', tot.actual, '% DE AVANCE GLOBAL DE PROYECTO', tot.avanceGlobal / 100],
    [`FINIQUITO (${pctTxt(hoja.finiquitoPct || 0)})`, tot.finiquito > 0.005 ? tot.finiquito : 'NA', 'ACUMULADO GLOBAL', tot.acumGlobal, '% AVANCE LEED', tot.avanceArea?.['Consultoría']],
    [`IMPORTE ESTIMABLE (${pctTxt(estimablePct)})`, tot.estimable, 'POR ESTIMAR', tot.porEstimar, '% AVANCE COMMISSIONING', tot.avanceArea?.Commissioning],
    ['IMPORTE ESTIMABLE ADICIONAL', 'NA', null, null, '% AVANCE MODELACIÓN ENERGÉTICA', tot.avanceArea?.['Modelación']],
  ]
  resumen.forEach(([k1, v1, k2, v2, k3, v3], i) => {
    const r = 8 + i
    ws.getRow(r).height = 19.5
    const sinBorde = { border: null }
    celda(`C${r}`, k1, { font: mont(i === 4 ? 9 : 11), ...sinBorde }); ws.mergeCells(`C${r}:D${r}`)
    celda(`E${r}`, v1, { font: goth(11), numFmt: MONEDA, align: { horizontal: 'right' }, ...sinBorde })
    if (k2) {
      celda(`F${r}`, k2, { font: goth(11, i === 1 ? { bold: true, italic: true } : {}), ...sinBorde }); ws.mergeCells(`F${r}:G${r}`)
      celda(`H${r}`, v2, { font: goth(11, i === 1 ? { bold: true, italic: true } : {}), numFmt: MONEDA, align: { horizontal: 'right' }, ...sinBorde }); ws.mergeCells(`H${r}:I${r}`)
    }
    celda(`K${r}`, k3, { font: mont(11, false, { italic: i >= 2 }), ...sinBorde }); ws.mergeCells(`K${r}:O${r}`)
    const pct = v3 == null ? 'NA' : (i >= 2 ? v3 / 100 : v3)
    celda(`P${r}`, pct, { font: mont(11, false, { italic: i >= 2 }), numFmt: '0.00%', align: { horizontal: 'center' }, ...sinBorde }); ws.mergeCells(`P${r}:Q${r}`)
  })
  bordeRango(8, 3, 12, 17, { top: { style: 'hair', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } })

  // ── Tabla de conceptos ──────────────────────────────────────────────────
  const H = 14
  ws.getRow(H).height = 39.75
  const enc = { font: mont(11), fill: relleno(GRIS), align: { horizontal: 'center' } }
  celda(`B${H}`, 'Clave', enc)
  unir(`C${H}:H${H}`, 'Concepto', enc)
  celda(`I${H}`, 'Entregable', enc)
  celda(`J${H}`, 'PRESUPUESTO OCULTAR', enc)
  celda(`K${H}`, 'MONTO', enc)
  unir(`L${H}:M${H}`, 'ANTERIOR', enc)
  unir(`N${H}:O${H}`, 'ESTIMADO ESTA ESTIMACIÓN', enc)
  celda(`P${H}`, 'ACUMULADO', enc)
  celda(`Q${H}`, 'POR ESTIMAR', enc)
  bordeRango(H, 2, H, 17)

  let r = H + 1
  const conFases = hoja.bloques.some(b => b.construccion)
  let faseActual = null
  const filasBloque = []
  hoja.bloques.forEach((b, bi) => {
    const fase = b.construccion ? 'CONSTRUCCIÓN' : 'DISEÑO'
    if (conFases && !b.finiquito && fase !== faseActual) {
      faseActual = fase
      ws.getRow(r).height = 30
      unir(`B${r}:Q${r}`, fase, { font: mont(16, true), fill: relleno(VERDE_FASE), align: { horizontal: 'center' } })
      bordeRango(r, 2, r, 17)
      r++
    }
    const rb = r
    const desde = r + 1, hasta = r + b.filas.length
    const verde = { fill: relleno(VERDE_DISCIPLINA), font: mont(11) }
    ws.getRow(rb).height = 21
    celda(`B${rb}`, bi + 1, { ...verde, align: { horizontal: 'center' } })
    unir(`C${rb}:I${rb}`, b.nombre, { ...verde, align: { horizontal: 'left' } })
    celda(`J${rb}`, null, verde)
    if (b.finiquito) {
      celda(`K${rb}`, 'FINIQUITO', { ...verde, align: { horizontal: 'center' } })
      unir(`L${rb}:M${rb}`, 'FINIQUITO', { ...verde, align: { horizontal: 'center' } })
      unir(`N${rb}:O${rb}`, 'FINIQUITO', { ...verde, align: { horizontal: 'center' } })
      celda(`P${rb}`, 'FINIQUITO', { ...verde, align: { horizontal: 'center' } })
      celda(`Q${rb}`, 'FINIQUITO', { ...verde, align: { horizontal: 'center' } })
    } else {
      const suma = (col, result) => (hasta >= desde ? { formula: `SUM(${col}${desde}:${col}${hasta})`, result } : 0)
      celda(`K${rb}`, suma('K', b.monto), { ...verde, numFmt: MONEDA, align: { horizontal: 'center' } })
      unir(`L${rb}:M${rb}`, suma('M', b.anterior), { ...verde, numFmt: MONEDA, align: { horizontal: 'center' } })
      unir(`N${rb}:O${rb}`, suma('O', b.esta), { ...verde, numFmt: MONEDA, align: { horizontal: 'center' } })
      celda(`P${rb}`, suma('P', b.acumulado), { ...verde, numFmt: MONEDA, align: { horizontal: 'center' } })
      celda(`Q${rb}`, { formula: `K${rb}-P${rb}`, result: b.monto - b.acumulado }, { ...verde, numFmt: MONEDA, align: { horizontal: 'center' } })
      filasBloque.push([rb, b])
    }
    bordeRango(rb, 2, rb, 17)
    r++

    for (const f of b.filas) {
      const altoTexto = Math.max(1, Math.ceil((f.concepto || '').length / 95), (f.entregable || '').split('\n').length)
      ws.getRow(r).height = Math.max(21, altoTexto * 14)
      const base = { font: goth(10), border: fila }
      const pctAnt = f.monto > 0 ? f.anterior / f.monto : 0
      const pctEsta = f.monto > 0 ? f.esta / f.monto : 0
      celda(`B${r}`, f.clave, { ...base, align: { horizontal: 'center' } })
      unir(`C${r}:H${r}`, f.concepto, { ...base, align: { horizontal: 'left' } })
      celda(`I${r}`, f.entregable, { ...base, font: goth(9), align: { horizontal: 'left' } })
      const captura = { ...base, fill: relleno(CAPTURA), numFmt: '0.00', align: { horizontal: 'center' } }
      const dinero = { ...base, numFmt: MONEDA, align: { horizontal: 'center' } }
      if (f.finiquito) {
        celda(`K${r}`, 'FINIQUITO', { ...base, align: { horizontal: 'center' } })
        celda(`L${r}`, pctAnt, captura); celda(`M${r}`, 'NA', { ...base, align: { horizontal: 'center' } })
        celda(`N${r}`, pctEsta, captura); celda(`O${r}`, f.esta > 0.005 ? f.esta : 0, dinero)
        celda(`P${r}`, 'NA', { ...base, align: { horizontal: 'center' } })
        celda(`Q${r}`, 'NA', { ...base, align: { horizontal: 'center' } })
      } else {
        celda(`K${r}`, Math.round(f.monto * 100) / 100, dinero)
        celda(`L${r}`, Math.round(pctAnt * 1e6) / 1e6, captura)
        celda(`M${r}`, { formula: `K${r}*L${r}`, result: f.anterior }, dinero)
        celda(`N${r}`, Math.round(pctEsta * 1e6) / 1e6, captura)
        celda(`O${r}`, { formula: `K${r}*N${r}`, result: f.esta }, dinero)
        celda(`P${r}`, { formula: `M${r}+O${r}`, result: f.acumulado }, dinero)
        celda(`Q${r}`, { formula: `K${r}-P${r}`, result: f.porEstimar }, dinero)
      }
      if (f.esta > 0.005) ws.getCell(`N${r}`).fill = relleno('FFC6EFCE')
      r++
    }
  })

  // ── Suma totales ─────────────────────────────────────────────────────────
  ws.getRow(r).height = 30
  const gris = { font: mont(11), fill: relleno(GRIS), numFmt: MONEDA, align: { horizontal: 'center' } }
  const sumaBloques = (col, campo) => (filasBloque.length
    ? { formula: filasBloque.map(([x]) => `${col}${x}`).join('+'), result: filasBloque.reduce((s, [, b]) => s + (campo === 'porEstimar' ? b.monto - b.acumulado : b[campo]), 0) }
    : 0)
  unir(`B${r}:I${r}`, 'SUMA TOTALES', { ...gris, align: { horizontal: 'right' } })
  celda(`J${r}`, null, gris)
  celda(`K${r}`, sumaBloques('K', 'monto'), gris)
  unir(`L${r}:M${r}`, sumaBloques('L', 'anterior'), gris)
  unir(`N${r}:O${r}`, sumaBloques('N', 'esta'), gris)
  celda(`P${r}`, sumaBloques('P', 'acumulado'), gris)
  celda(`Q${r}`, sumaBloques('Q', 'porEstimar'), gris)
  bordeRango(r, 2, r, 17)

  ws.pageSetup.printArea = `A1:R${r + 1}`
  ws.pageSetup.printTitlesRow = `${H}:${H}`
  wb.calcProperties = { fullCalcOnLoad: true }
  return wb
}

export async function descargarEstimacionBea(hoja) {
  const ExcelJS = (await import('exceljs')).default
  let logo = null
  try { logo = await cargarLogoBea() } catch { /* sin logo, el resto sale igual */ }
  const wb = await libroEstimacion(ExcelJS, hoja, logo)
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  const codigo = (hoja.proyecto || '').split(/[-_]/)[0]
  a.href = url; a.download = `${codigo}-Estimación ${hoja.numero}.xlsx`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
