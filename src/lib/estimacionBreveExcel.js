// Excel de la versión breve (carta vertical): resumen, avance por disciplina y solo los conceptos cobrados.
import { cargarExcelJS, bajarArchivo } from './cargarModulo.js'
import { cargarLogoBea } from './estimacionExcel.js'
import { armarBreve, nombreBreve } from './estimacionBreve.js'
import { fmtDate } from '../utils/format.js'

const NAVY = 'FF0D1B2A', VERDE = 'FF0F7A37', GRIS = 'FF7B8794', FONDO = 'FFF3F5F7', LINEA = 'FFE4E7EB'

export async function libroBreve(ExcelJS, hoja, logo, elaboradoPor = '') {
  const b = armarBreve(hoja)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Estimación ${b.numero}`, {
    pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.7, header: 0.2, footer: 0.3 } },
    headerFooter: { oddFooter: `&8Estimación #${b.numero} · ${b.proyecto}&R&8Generado: ${fmtDate(new Date().toISOString().slice(0, 10))} · Elaborado por: ${elaboradoPor || '—'}` },
  })
  ws.columns = [{ width: 10 }, { width: 46 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }]
  const fmt = b.moneda === 'USD' ? '"US$"#,##0.00' : '"$"#,##0.00'
  const borde = { bottom: { style: 'thin', color: { argb: LINEA } } }

  if (logo) { const id = wb.addImage({ buffer: logo, extension: 'jpeg' }); ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 44 } }) }
  ws.mergeCells('D1:H1'); ws.getCell('D1').value = b.proyecto
  ws.mergeCells('D2:H2'); ws.getCell('D2').value = `Cliente: ${b.cliente || '—'}`
  ws.mergeCells('D3:H3'); ws.getCell('D3').value = `Periodo: ${fmtDate(b.periodFrom)} — ${fmtDate(b.periodTo)}`
  ;['D1', 'D2', 'D3'].forEach((c, i) => { const x = ws.getCell(c); x.alignment = { horizontal: 'right' }; x.font = { size: i ? 10 : 11, bold: !i, color: { argb: i ? 'FF555555' : NAVY } } })
  for (let c = 1; c <= 8; c++) ws.getCell(4, c).border = { bottom: { style: 'medium', color: { argb: 'FF16A34A' } } }

  ws.mergeCells('A6:H6'); ws.getCell('A6').value = b.titulo; ws.getCell('A6').font = { size: 16, bold: true, color: { argb: NAVY } }
  let r = 8
  const titulo = t => { ws.mergeCells(r, 1, r, 8); const c = ws.getCell(r, 1); c.value = t; c.font = { size: 12, bold: true, color: { argb: NAVY } }; c.border = { left: { style: 'thick', color: { argb: 'FF16A34A' } } }; r += 1 }

  // Pares etiqueta | valor en dos columnas: (A:B | C:D) y (E:F | G), como tarjetas en renglones
  const par = (fila, lado, etq, valor, numFmt, color) => {
    const [l1, l2, v1, v2] = lado ? [5, 6, 7, 7] : [1, 2, 3, 4]
    ws.mergeCells(fila, l1, fila, l2); if (v2 > v1) ws.mergeCells(fila, v1, fila, v2)
    const e = ws.getCell(fila, l1); e.value = etq.toUpperCase(); e.font = { size: 8, bold: true, color: { argb: GRIS } }; e.alignment = { vertical: 'middle', wrapText: true, indent: lado ? 1 : 0 }
    const x = ws.getCell(fila, v1); x.value = valor; if (numFmt) x.numFmt = numFmt
    x.font = { size: 12, bold: true, color: { argb: color } }; x.alignment = { horizontal: 'right', vertical: 'middle' }
    for (let c = l1; c <= v2; c++) ws.getCell(fila, c).border = borde
    ws.getRow(fila).height = 20
  }

  titulo('Resumen Financiero')
  b.tarjetas.forEach(([etq, v, tipo, verde], i) => {
    par(r + Math.floor(i / 2), i % 2, etq, tipo === 'pct' ? (v || 0) / 100 : v || 0, tipo === 'pct' ? '0.0%' : fmt, verde ? VERDE : NAVY)
  })
  r += Math.ceil(b.tarjetas.length / 2) + 1

  titulo('Avance por Disciplina')
  b.avances.forEach((a, i) => {
    par(r + Math.floor(i / 2), i % 2, a.nombre, a.pct == null ? '—' : a.pct / 100, a.pct == null ? null : '0.0%', a.pct == null ? GRIS : NAVY)
  })
  r += Math.ceil(b.avances.length / 2) + 1

  titulo('Conceptos Incluidos en esta Estimación')
  if (!b.bloques.length) { ws.getCell(r, 1).value = 'Esta estimación todavía no tiene conceptos cobrados.'; ws.getCell(r, 1).font = { italic: true, color: { argb: GRIS } }; r += 1 }
  for (const bl of b.bloques) {
    r += 1
    ws.mergeCells(r, 1, r, 8)
    const d = ws.getCell(r, 1); d.value = `${bl.nombre} — Estimable: ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: b.moneda }).format(bl.estimable)}`
    d.font = { bold: true, size: 10, color: { argb: NAVY } }; d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO } }; d.border = { left: { style: 'thick', color: { argb: 'FF16A34A' } } }
    r += 1
    const enc = ws.getRow(r); enc.values = ['CLAVE', 'DESCRIPCIÓN', 'MONTO TOTAL', 'ANT. ANTERIOR', 'ESTA EST.', 'ACUMULADO', 'POR ESTIMAR', '% AVANCE']
    enc.eachCell((c, i) => { c.font = { size: 8, bold: true, color: { argb: 'FF52606D' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO } }; c.alignment = { horizontal: i > 2 ? 'right' : 'left', vertical: 'middle', wrapText: true }; c.border = { bottom: { style: 'medium', color: { argb: LINEA } } } })
    r += 1
    for (const f of bl.filas) {
      const row = ws.getRow(r)
      row.values = [f.clave + (f.finiquito ? ' (FIN)' : ''), f.concepto, f.monto, f.anterior, f.esta, f.acumulado, f.porEstimar, f.avance == null ? '—' : f.avance]
      row.eachCell((c, i) => {
        c.font = { size: 9, bold: i === 1 || i === 5, color: { argb: i === 5 ? VERDE : NAVY } }
        c.alignment = { vertical: 'top', wrapText: i === 2, horizontal: i > 2 ? 'right' : 'left' }
        if (i > 2 && i < 8) c.numFmt = fmt
        if (i === 8) c.numFmt = '0.##%'
        c.border = borde
        if (f.finiquito) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
      })
      if (f.nota) {
        const d = row.getCell(2)
        d.value = { richText: [{ text: f.concepto || '', font: { size: 9, color: { argb: NAVY } } }, { text: `\n${f.nota}`, font: { size: 8, italic: true, color: { argb: 'FFB7791F' } } }] }
      }
      r += 1
    }
  }
  return wb
}

export async function descargarBreve(hoja, elaboradoPor) {
  const ExcelJS = await cargarExcelJS()
  let logo = null
  try { logo = await cargarLogoBea('jpg') } catch { /* sin logo, el resto sale igual */ }
  const wb = await libroBreve(ExcelJS, hoja, logo, elaboradoPor)
  bajarArchivo(await wb.xlsx.writeBuffer(), `${nombreBreve(hoja)}.xlsx`)
}
