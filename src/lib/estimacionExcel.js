// Estimación en el formato BEA RC-OP-11 "ESTIMACIÓN DE AVANCE", copiado celda por celda de la hoja
// del libro de cada proyecto (referencia: 615.xlsx, hoja OCT2026): mismos anchos, altos, tipografías,
// bordes, rellenos, formato condicional y fórmulas por renglón.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

import { cargarExcelJS, bajarArchivo } from './cargarModulo.js'

export const MONEDA = '"$"#,##0.00;[Red]"$"#,##0.00'
const CONTABLE = '_([$$-409]* #,##0.00_);_([$$-409]* (#,##0.00);_([$$-409]* "-"??_);_(@_)'

export async function cargarLogoBea(ext = 'png') {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const r = await fetch(`${base}formatos/logo-bea.${ext}`)
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
const r2 = v => Math.round((v || 0) * 100) / 100

/**
 * Número de cada disciplina como en el libro: el que trae la clave de sus conceptos ("3.01" → 3, "2.A.01" → 2.A);
 * la certificación (finiquito) o una disciplina sin clave numérica lleva el siguiente al último.
 */
export function numerosDisciplina(bloques) {
  let ultimo = 0
  return bloques.map((b, i) => {
    const m = String(b.filas[0]?.clave || '').match(/^\s*(\d+(?:\.[A-Z])?)[.,]/i)
    let n = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]) : i + 1
    if (b.finiquito || !m) n = ultimo + 1
    ultimo = typeof n === 'number' ? n : Math.max(ultimo, parseInt(n, 10) || 0)
    return n
  })
}

/** Arma el libro (sin descargarlo). hoja = armarHoja(...); logo = bytes del logo .jpg del libro */
export async function libroEstimacion(ExcelJS, hoja, logo) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Estimación ${hoja.numero}`, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 3, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, verticalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0, footer: 0 } },
  })
  ws.columns = [7.11, 6.67, 16.67, 16.67, 16.67, 16.67, 14.67, 14.67, 14.67, 23, 23, 23, 23, 23, 23, 23, 23].map(width => ({ width }))
  ws.getColumn(10).hidden = true // "PRESUPUESTO OCULTAR"

  const negro = { argb: 'FF000000' }
  const gris = { argb: 'FFA5A5A5' }
  const L = (style, color = negro) => ({ style, color })
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const F = (name, size, extra = {}) => ({ name, size, color: { theme: 1 }, ...extra })
  const mont = (s = 12, x) => F('Montserrat', s, x)
  const gb = (s = 11, x) => F('Gotham Book', s, x)     // "Gotham Book" en el libro
  const gbk = (s = 11, x) => F('Gotham-Book', s, x)    // "Gotham-Book" en el libro
  const arial = (s = 11, x) => F('Arial', s, x)

  const poner = (rango, value, { font, fill, numFmt, h, v = 'middle', wrap = false } = {}) => {
    const [a, b] = rango.split(':')
    if (b) ws.mergeCells(rango)
    const c = ws.getCell(a)
    if (value !== undefined) c.value = value
    if (font) c.font = font
    if (fill) c.fill = fill
    if (numFmt) c.numFmt = numFmt
    c.alignment = { vertical: v, ...(h ? { horizontal: h } : {}), ...(wrap ? { wrapText: true } : {}) }
    return c
  }
  /** Bordes de un rango: lados exteriores (t, b, l, r) y líneas interiores (iv verticales, ih horizontales) */
  const caja = (r1, c1, r2_, c2, { t, b, l, r, iv, ih } = {}) => {
    for (let y = r1; y <= r2_; y++) for (let x = c1; x <= c2; x++) {
      const cell = ws.getCell(y, x)
      const bo = { ...(cell.border || {}) }
      if (y === r1 && t) bo.top = t
      if (y === r2_ && b) bo.bottom = b
      if (x === c1 && l) bo.left = l
      if (x === c2 && r) bo.right = r
      if (iv && x < c2) bo.right = iv
      if (iv && x > c1) bo.left = iv
      if (ih && y < r2_) bo.bottom = ih
      if (ih && y > r1) bo.top = ih
      cell.border = bo
    }
  }
  const rellenar = (r, c1, c2, fill, font) => { for (let x = c1; x <= c2; x++) { const c = ws.getCell(r, x); c.fill = fill; if (font) c.font = font } }

  // ── Encabezado (B2:Q6) ───────────────────────────────────────────────────
  ws.getRow(1).height = 15.75
  ws.getRow(2).height = 33
  ;[3, 4, 5, 6].forEach(r => { ws.getRow(r).height = 19.5 })
  ws.getRow(7).height = 21
  if (logo) {
    const id = wb.addImage({ buffer: logo, extension: 'jpeg' })
    ws.addImage(id, { tl: { nativeCol: 1, nativeColOff: 19050, nativeRow: 1, nativeRowOff: 238125 }, ext: { width: 489, height: 134 }, editAs: 'oneCell' })
  }
  poner('F2:N2', 'ESTIMACIÓN DE AVANCE ', { font: mont(16), h: 'center' })
  poner('O2', null, { font: mont(16), h: 'center' })
  poner('P2', 'RC-OP-11 Rev.3-06/22', { font: gb(11) })
  poner('Q2', new Date(), { font: gb(11), h: 'left', numFmt: '[$-80A]d" de "mmmm" de "yyyy' })
  poner('F3:K4', `Proyecto: ${hoja.proyecto || ''}`, { font: arial(11), h: 'center' })
  poner('L3:O4', `Cliente: ${hoja.cliente || ''}`, { font: arial(11), h: 'center' })
  poner('P3', 'FECHA DE INICIO:  ', { font: gb(11) })
  poner('Q3', fechaExcel(hoja.inicio) || 'TBD', { font: arial(11), h: 'right', numFmt: '[$-80A]mmmm yyyy' })
  poner('P4', 'FECHA DE TERMINACIÓN:       ', { font: gb(11) })
  poner('Q4', fechaExcel(hoja.fin) || 'TBD', { font: arial(11), h: 'right', numFmt: '[$-80A]mmmm yyyy' })
  poner('F5:K6', `Ubicación: ${hoja.ubicacion || ''}`, { font: arial(11), h: 'center' })
  poner('L5:O6', `TIPO DE MONEDA: ${hoja.moneda || 'MXN'}`, { font: gb(11), h: 'center' })
  poner('P5:Q6', `PERIODO DE ESTIMACIÓN: \n${textoPeriodo(hoja.periodFrom, hoja.periodTo)}`, { font: arial(11), h: 'center', wrap: true })
  caja(2, 2, 6, 5, { t: L('medium'), l: L('medium'), b: L('medium'), r: L('thin') })
  caja(2, 6, 2, 15, { t: L('medium'), b: L('thin'), l: L('thin') })
  caja(3, 6, 4, 11, { t: L('thin'), l: L('thin'), b: L('thin') })
  caja(3, 12, 4, 15, { t: L('thin'), l: L('thin'), b: L('thin') })
  caja(5, 6, 6, 11, { t: L('thin'), l: L('thin'), b: L('medium') })
  caja(5, 12, 6, 15, { t: L('thin'), l: L('thin'), b: L('medium') })
  caja(2, 16, 4, 16, { t: L('medium'), l: L('thin'), ih: L('thin'), b: L('thin') })
  caja(2, 17, 4, 17, { t: L('medium'), l: L('thin'), ih: L('thin'), b: L('thin'), r: L('medium') })
  caja(5, 16, 6, 17, { t: L('thin'), l: L('thin'), b: L('medium'), r: L('medium') })

  // ── Resumen de importes (C8:Q12) ─────────────────────────────────────────
  ws.getRow(8).height = 21
  ;[9, 10, 11, 12].forEach(r => { ws.getRow(r).height = 19.5 })
  ws.getRow(13).height = 21.75
  const tot = hoja.totales
  const estimablePct = 100 - (hoja.anticipoPct || 0) - (hoja.finiquitoPct || 0)
  const area = a => (tot.avanceArea?.[a] == null ? 'NA' : tot.avanceArea[a] / 100)
  const filas = [
    ['IMPORTE TOTAL', r2(tot.importe), 'ACUMULADO ANTERIOR', r2(tot.acumAnterior), MONEDA, '% AVANCE ESTA ESTIMACIÓN', tot.avanceEsta / 100],
    [`ANTICIPO (${pctTxt(hoja.anticipoPct || 0)})`, tot.anticipo > 0.005 ? r2(tot.anticipo) : 'NA', 'ESTIMACIÓN ACTUAL', r2(tot.actual), MONEDA, '% DE AVANCE GLOBAL DE PROYECTO', tot.avanceGlobal / 100],
    [`FINIQUITO (${pctTxt(hoja.finiquitoPct || 0)})`, tot.finiquito > 0.005 ? r2(tot.finiquito) : 'NA', 'ACUMULADO GLOBAL', r2(tot.acumGlobal), CONTABLE, '     % AVANCE LEED', area('Consultoría')],
    [`IMPORTE ESTIMABLE (${pctTxt(estimablePct)})`, r2(tot.estimable), 'POR ESTIMAR', r2(tot.porEstimar), CONTABLE, '     % AVANCE COMMISSIONING', area('Commissioning')],
    ['IMPORTE ESTIMABLE ADICIONAL', 0, null, null, null, '     % AVANCE MODELACIÓN ENERGÉTICA', area('Modelación')],
  ]
  filas.forEach(([k1, v1, k2, v2, fmt2, k3, v3], i) => {
    const r = 8 + i
    const neg = i === 1 ? { bold: true, italic: true } : {}
    poner(`C${r}`, k1, { font: mont(i === 4 ? 10 : 12), h: 'left', v: 'top' })
    poner(`E${r}`, v1, { font: gbk(12), numFmt: MONEDA })
    if (k2) {
      poner(`F${r}`, k2, { font: gb(12, neg), numFmt: '0%' })
      poner(`H${r}:I${r}`, v2, { font: gb(12, neg), h: 'right', numFmt: fmt2 })
    } else {
      poner(`G${r}:H${r}`, null)
    }
    poner(`K${r}`, k3, { font: i === 1 ? gb(12) : mont(12, i >= 2 ? { italic: true } : {}), h: 'left', numFmt: '0%' })
    poner(`P${r}:Q${r}`, v3, { font: mont(12, i >= 2 ? { italic: true } : {}), h: 'center', numFmt: '0.00%' })
  })
  // Marco exterior de toda la hoja: renglón 7 (lados), resumen B8:Q12 y renglón 13 (arriba y lados)
  caja(7, 2, 7, 17, { l: L('medium'), r: L('medium') })
  caja(8, 2, 12, 17, { t: L('medium'), ih: L('thin'), l: L('medium'), r: L('medium'), b: L('medium') })
  caja(8, 6, 11, 6, { l: L('thin') })
  caja(8, 11, 12, 11, { l: L('medium') })
  caja(13, 2, 13, 17, { t: L('medium'), l: L('medium'), r: L('medium') })

  // ── Tabla de conceptos ──────────────────────────────────────────────────
  const H = 14
  ws.getRow(H).height = 39.75
  const enc = { font: mont(12), fill: relleno('FFD8D8D8'), h: 'center' }
  poner(`B${H}`, 'Clave', enc)
  poner(`C${H}:H${H}`, 'Concepto', enc)
  poner(`I${H}`, 'Entregable', enc)
  poner(`J${H}`, 'PRESUPUESTO OCULTAR', { ...enc, numFmt: '0%' })
  poner(`K${H}`, 'MONTO', { ...enc, numFmt: '0%' })
  poner(`L${H}:M${H}`, 'ANTERIOR', { ...enc, wrap: true })
  poner(`N${H}:O${H}`, 'ESTIMADO ESTA ESTIMACIÓN', { ...enc, wrap: true })
  poner(`P${H}`, 'ACUMULADO', { ...enc, wrap: true })
  poner(`Q${H}`, 'POR ESTIMAR', { ...enc, wrap: true })
  caja(H, 2, H, 17, { t: L('thin'), b: L('thin'), l: L('medium'), r: L('medium'), iv: L('thin') })

  let r = H + 1
  const conFases = hoja.bloques.some(b => b.construccion)
  let faseActual = null
  const numeros = numerosDisciplina(hoja.bloques)
  const filasBloque = []
  const capturas = []
  hoja.bloques.forEach((b, bi) => {
    const fase = b.construccion ? 'CONSTRUCCIÓN' : 'DISEÑO'
    if (conFases && !b.finiquito && fase !== faseActual) {
      faseActual = fase
      ws.getRow(r).height = 39.75
      poner(`B${r}:Q${r}`, fase, { font: { name: 'Montserrat', size: 18, bold: true }, fill: relleno('FF76923C'), h: 'center' })
      caja(r, 2, r, 17, { t: L('thin'), b: L('thin'), l: L('medium'), r: L('medium') })
      r++
    }
    const rb = r
    const desde = r + 1, hasta = r + b.filas.length
    const verde = relleno('FFEAF1DD')
    ws.getRow(rb).height = 19.5
    rellenar(rb, 2, 17, verde, mont(12))
    poner(`B${rb}`, numeros[bi], { font: mont(12), fill: verde, h: 'center' })
    poner(`C${rb}`, b.nombre, { font: mont(12), fill: verde, h: 'left' })
    const dinero = { font: mont(12), fill: verde, h: 'center', numFmt: MONEDA }
    if (b.finiquito) {
      poner(`J${rb}`, hasta >= desde ? { formula: `SUM(J${desde}:J${hasta})`, result: 1 } : 0, { ...dinero, numFmt: '0.0%' })
      poner(`K${rb}`, 'FINIQUITO', dinero)
      poner(`L${rb}:M${rb}`, 'FINIQUITO', dinero)
      poner(`N${rb}:O${rb}`, 'FINIQUITO', dinero)
      poner(`P${rb}`, 'FINIQUITO', dinero)
      poner(`Q${rb}`, 'FINIQUITO', dinero)
    } else {
      const suma = (col, result) => (hasta >= desde ? { formula: `SUM(${col}${desde}:${col}${hasta})`, result: r2(result) } : 0)
      poner(`J${rb}`, suma('J', 1), { ...dinero, numFmt: '0%' })
      poner(`K${rb}`, r2(b.monto), dinero)
      poner(`L${rb}:M${rb}`, suma('M', b.anterior), dinero)
      poner(`N${rb}:O${rb}`, suma('O', b.esta), dinero)
      poner(`P${rb}`, suma('P', b.acumulado), dinero)
      poner(`Q${rb}`, { formula: `K${rb}-P${rb}`, result: r2(b.monto - b.acumulado) }, dinero)
      filasBloque.push([rb, b])
    }
    caja(rb, 2, rb, 17, { t: L('thin'), b: L('thin'), l: L('medium'), r: L('medium') })
    ws.getCell(`B${rb}`).border = { ...ws.getCell(`B${rb}`).border, right: L('thin') }
    ws.getCell(`C${rb}`).border = { ...ws.getCell(`C${rb}`).border, left: L('hair', gris) }
    for (const x of [11, 12, 14, 16, 17]) ws.getCell(rb, x).border = { ...ws.getCell(rb, x).border, left: L('thin') }
    r++

    const montoBloque = b.filas.reduce((s, f) => s + (f.finiquito ? 0 : f.monto), 0)
    for (const f of b.filas) {
      // Alto según el texto acomodado: concepto (C:H, ~95 caracteres por línea) y entregable (I, ~20 por línea a 10 pt)
      const lineasDe = (t, ancho) => String(t || '').split(/\r?\n/).reduce((n, l) => n + Math.max(1, Math.ceil(l.length / ancho)), 0)
      const lineas = Math.max(1, lineasDe(f.concepto, 95) + (f.nota ? 1 : 0), lineasDe(f.entregable, 20))
      ws.getRow(r).height = Math.max(21, lineas * 14 + 4)
      const pctAnt = f.monto > 0 ? f.anterior / f.monto : 0
      const pctEsta = f.monto > 0 ? f.esta / f.monto : 0
      const cen = { font: gbk(11), h: 'center' }
      const din = { ...cen, numFmt: MONEDA }
      const cap = { fill: relleno('FFFFF2DC'), h: 'center', numFmt: '0.00' }
      poner(`B${r}`, f.clave, { ...cen, numFmt: '0.00' })
      // Cobro en partes: nota corta debajo del concepto ("Cobro parcial: 50% en esta estimación")
      poner(`C${r}:H${r}`, f.nota
        ? { richText: [{ text: f.concepto || '', font: gbk(11) }, { text: `\n${f.nota}`, font: { ...gbk(9), italic: true, color: { argb: 'FFB7791F' } } }] }
        : f.concepto, { font: gbk(11), wrap: true })
      poner(`I${r}`, f.entregable, { font: gbk(10), h: 'left', wrap: true, numFmt: '0%' })
      poner(`J${r}`, montoBloque > 0 && !f.finiquito ? f.monto / montoBloque : 0, { ...cen, numFmt: '0.00%' })
      if (f.finiquito) {
        poner(`K${r}`, 'FINIQUITO', din)
        poner(`L${r}`, r2(pctAnt), { ...cap, font: arial(11) })
        poner(`M${r}`, 'NA', din)
        poner(`N${r}`, r2(pctEsta), { ...cap, font: arial(11) })
        poner(`O${r}`, r2(f.esta), din)
        poner(`P${r}`, 'NA', din)
        poner(`Q${r}`, 'NA', din)
      } else {
        poner(`K${r}`, r2(f.monto), din)
        poner(`L${r}`, Math.round(pctAnt * 1e6) / 1e6, { ...cap, font: gbk(11) })
        poner(`M${r}`, { formula: `IF(L${r}>0, K${r}*L${r}, 0)`, result: r2(f.anterior) }, din)
        poner(`N${r}`, Math.round(pctEsta * 1e6) / 1e6, { ...cap, font: arial(11) })
        poner(`O${r}`, { formula: `IF(N${r}>0, K${r}*N${r}, 0)`, result: r2(f.esta) }, din)
        poner(`P${r}`, { formula: `M${r}+O${r}`, result: r2(f.acumulado) }, din)
        poner(`Q${r}`, { formula: `K${r}-P${r}`, result: r2(f.porEstimar) }, din)
      }
      capturas.push(r)
      // Bordes del renglón como en el libro: punteado fino arriba/abajo, verticales delgados
      for (let x = 2; x <= 17; x++) {
        const bo = { top: L('hair'), bottom: L('hair') }
        if (x === 2) { bo.left = L('medium'); bo.right = L('thin') }
        else if (x >= 3 && x <= 8) { bo.top = L('hair', gris); bo.bottom = L('hair', gris); if (x === 3) bo.left = L('hair', gris) }
        else if (x >= 10) { bo.left = L('thin'); bo.right = x === 17 ? L('medium') : L('hair', gris) }
        ws.getCell(r, x).border = bo
      }
      r++
    }
  })

  // Verde cuando el avance del concepto es 1 (anterior o esta), igual que el libro
  if (capturas.length) {
    ws.addConditionalFormatting({
      ref: capturas.map(x => `L${x} N${x}`).join(' '),
      rules: [{ type: 'cellIs', operator: 'equal', formulae: [1], priority: 1,
        style: { font: { color: { argb: 'FF006100' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' }, fgColor: { argb: 'FFC6EFCE' } } } }],
    })
  }

  // ── Suma totales ─────────────────────────────────────────────────────────
  ws.getRow(r).height = 30
  const g = { font: mont(12), fill: relleno('FFD8D8D8'), h: 'center', numFmt: MONEDA }
  const sumaBloques = (col, campo) => (filasBloque.length
    ? { formula: filasBloque.map(([x]) => `${col}${x}`).join('+'), result: r2(filasBloque.reduce((s, [, b]) => s + (campo === 'porEstimar' ? b.monto - b.acumulado : b[campo]), 0)) }
    : 0)
  poner(`B${r}:I${r}`, 'SUMA TOTALES', { font: mont(12), fill: relleno('FFD8D8D8'), h: 'right' })
  poner(`J${r}`, null, { ...g, numFmt: '0%' })
  poner(`K${r}`, sumaBloques('K', 'monto'), g)
  poner(`L${r}:M${r}`, sumaBloques('L', 'anterior'), g)
  poner(`N${r}:O${r}`, sumaBloques('N', 'esta'), g)
  poner(`P${r}`, sumaBloques('P', 'acumulado'), g)
  poner(`Q${r}`, sumaBloques('Q', 'porEstimar'), { ...g, fill: relleno('FFD9D9D9'), font: mont(12, { color: { argb: 'FF000000' } }) })
  caja(r, 2, r, 17, { t: L('thin'), b: L('medium'), l: L('medium'), r: L('medium') })
  for (const x of [11, 12, 14, 16, 17]) ws.getCell(r, x).border = { ...ws.getCell(r, x).border, left: L('thin') }

  ws.pageSetup.printArea = `A1:R${r + 1}`
  wb.calcProperties = { fullCalcOnLoad: true }
  return wb
}

export async function descargarEstimacionBea(hoja) {
  const ExcelJS = await cargarExcelJS()
  let logo = null
  try { logo = await cargarLogoBea('jpg') } catch { /* sin logo, el resto sale igual */ }
  const wb = await libroEstimacion(ExcelJS, hoja, logo)
  const buf = await wb.xlsx.writeBuffer()
  const codigo = (hoja.proyecto || '').split(/[-_]/)[0]
  bajarArchivo(buf, `${codigo}-Estimación ${hoja.numero}.xlsx`)
}
