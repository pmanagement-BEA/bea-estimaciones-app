import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { disciplineSubtotal, conceptAmount, itemAmount, AREAS } from '../utils/calculations'

/**
 * Datos de la estimación con el formato que se manda al cliente
 * (mismo orden que la hoja "ESTIMACIÓN DE AVANCE" de los libros).
 */
export function armarHoja({ project, estimation, disciplines, items, summary, rates }) {
  const { totals, acumMap } = summary
  const bloques = disciplines
    .filter(d => disciplineSubtotal(d, rates).conDesc > 0 || (d.concepts || []).some(c => c.type === 'Finiquito' && totals.finiquito > 0))
    .map(d => {
      const filas = (d.concepts || []).map(c => {
        const monto = conceptAmount(c, d, rates, disciplines)
        const anterior = acumMap[c.id] || 0
        const esta = itemAmount(items[c.id], c, d, rates, disciplines)
        return {
          clave: c.key, concepto: c.description, entregable: c.deliverable || '',
          monto, anterior, esta, acumulado: anterior + esta, porEstimar: Math.max(0, monto - anterior - esta),
        }
      })
      const suma = k => filas.reduce((s, f) => s + f[k], 0)
      return { nombre: d.name, filas, monto: suma('monto'), anterior: suma('anterior'), esta: suma('esta'), acumulado: suma('acumulado'), porEstimar: suma('porEstimar') }
    })
  return {
    numero: estimation.number,
    proyecto: project.name, cliente: project.client, ubicacion: project.location, moneda: project.currency,
    periodo: `${fmtDate(estimation.period_from)} — ${fmtDate(estimation.period_to)}`,
    resumen: [
      ['Importe total', totals.conDescuento],
      [`Anticipo (${fmtPct(rates.anticipoPct)})`, totals.anticipo],
      [`Finiquito (${fmtPct(rates.finiquitoPct)})`, totals.finiquito],
      [`Importe estimable (${fmtPct(100 - rates.anticipoPct - rates.finiquitoPct)})`, totals.estimable],
      ['Acumulado anterior', summary.acumAnterior],
      ['Estimación actual', summary.actual],
      ['Acumulado global', summary.acumGlobal],
      ['Por estimar', summary.porEstimar],
    ],
    avances: [
      ['% avance esta estimación', summary.advanceThis],
      ['% avance global del proyecto', summary.advanceGlobal],
      ...AREAS.filter(a => summary.areaAvance[a]).map(a => [`% avance ${a}`, summary.areaAvance[a].pct]),
    ],
    bloques,
  }
}

const th = { background: '#0F2A44', color: '#fff', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, padding: '6px 8px' }
const num = { textAlign: 'right', whiteSpace: 'nowrap' }

/** Vista imprimible (PDF con el botón de imprimir del navegador). */
export default function HojaCliente({ hoja }) {
  const m = v => fmtMoney(v, hoja.moneda)
  return (
    <div className="hoja-cliente" style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)' }}>BEA<span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--green)', marginLeft: 3, transform: 'skewX(-15deg)' }} /></div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Bioconstrucción y Energía Alternativa, S.A. de C.V.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--navy)' }}>ESTIMACIÓN DE AVANCE No. {hoja.numero}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Periodo: {hoja.periodo}</div>
        </div>
      </div>

      <table style={{ width: '100%', fontSize: 11, marginBottom: 12 }}>
        <tbody>
          <tr><td style={{ width: 90, fontWeight: 700 }}>Proyecto</td><td>{hoja.proyecto}</td><td style={{ width: 70, fontWeight: 700 }}>Cliente</td><td>{hoja.cliente || '—'}</td></tr>
          <tr><td style={{ fontWeight: 700 }}>Ubicación</td><td>{hoja.ubicacion || '—'}</td><td style={{ fontWeight: 700 }}>Moneda</td><td>{hoja.moneda}</td></tr>
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <table style={{ fontSize: 11 }}>
          <tbody>{hoja.resumen.map(([k, v]) => (
            <tr key={k}><td style={{ padding: '3px 6px', fontWeight: 600 }}>{k}</td><td style={{ ...num, padding: '3px 6px' }}>{m(v)}</td></tr>
          ))}</tbody>
        </table>
        <table style={{ fontSize: 11 }}>
          <tbody>{hoja.avances.map(([k, v]) => (
            <tr key={k}><td style={{ padding: '3px 6px', fontWeight: 600 }}>{k}</td><td style={{ ...num, padding: '3px 6px' }}>{fmtPct(v)}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 50 }}>Clave</th><th style={th}>Concepto</th><th style={{ ...th, width: 150 }}>Entregable</th>
            <th style={{ ...th, ...num }}>Monto</th><th style={{ ...th, ...num }}>Anterior</th><th style={{ ...th, ...num }}>Esta estimación</th>
            <th style={{ ...th, ...num }}>Acumulado</th><th style={{ ...th, ...num }}>Por estimar</th>
          </tr>
        </thead>
        <tbody>
          {hoja.bloques.map(b => [
            <tr key={b.nombre} style={{ background: '#E8F5EC', fontWeight: 700 }}>
              <td colSpan={3} style={{ padding: '5px 8px' }}>{b.nombre}</td>
              <td style={num}>{m(b.monto)}</td><td style={num}>{m(b.anterior)}</td><td style={num}>{m(b.esta)}</td>
              <td style={num}>{m(b.acumulado)}</td><td style={num}>{m(b.porEstimar)}</td>
            </tr>,
            ...b.filas.map((f, i) => (
              <tr key={b.nombre + i} style={{ borderBottom: '1px solid #eee', background: f.esta > 0.005 ? '#FFFBEA' : undefined }}>
                <td style={{ padding: '3px 8px' }}>{f.clave}</td><td>{f.concepto}</td>
                <td style={{ whiteSpace: 'pre-line', color: '#555' }}>{f.entregable}</td>
                <td style={num}>{m(f.monto)}</td><td style={num}>{m(f.anterior)}</td>
                <td style={{ ...num, fontWeight: f.esta > 0.005 ? 700 : 400 }}>{f.esta > 0.005 ? m(f.esta) : '—'}</td>
                <td style={num}>{m(f.acumulado)}</td><td style={num}>{m(f.porEstimar)}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  )
}

/** Descarga la hoja como .xlsx (ExcelJS se carga solo al usarlo). */
export async function descargarExcel(hoja) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Estimación ${hoja.numero}`, { pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = [{ width: 9 }, { width: 52 }, { width: 34 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 15 }, { width: 15 }]
  const moneda = '"$"#,##0.00'
  const navy = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A44' } }
  const verde = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EC' } }

  ws.mergeCells('A1:H1'); ws.getCell('A1').value = `ESTIMACIÓN DE AVANCE No. ${hoja.numero}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.addRow([`Proyecto: ${hoja.proyecto}`, '', '', '', `Cliente: ${hoja.cliente || ''}`])
  ws.addRow([`Ubicación: ${hoja.ubicacion || ''}`, '', '', '', `Tipo de moneda: ${hoja.moneda}`])
  ws.addRow([`Periodo: ${hoja.periodo}`])
  ws.addRow([])
  const n = Math.max(hoja.resumen.length, hoja.avances.length)
  for (let i = 0; i < n; i++) {
    const [k1, v1] = hoja.resumen[i] || []
    const [k2, v2] = hoja.avances[i] || []
    const r = ws.addRow([k1 || '', '', v1 ?? null, '', k2 || '', '', v2 != null ? v2 / 100 : null])
    r.getCell(1).font = { bold: true }; r.getCell(5).font = { bold: true }
    r.getCell(3).numFmt = moneda; r.getCell(7).numFmt = '0.0%'
  }
  ws.addRow([])
  const h = ws.addRow(['Clave', 'Concepto', 'Entregable', 'Monto', 'Anterior', 'Esta estimación', 'Acumulado', 'Por estimar'])
  h.eachCell(c => { c.fill = navy; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { vertical: 'middle', wrapText: true } })
  for (const b of hoja.bloques) {
    const r = ws.addRow(['', b.nombre, '', b.monto, b.anterior, b.esta, b.acumulado, b.porEstimar])
    r.eachCell(c => { c.fill = verde; c.font = { bold: true } })
    for (const f of b.filas) {
      const fr = ws.addRow([f.clave, f.concepto, f.entregable, f.monto, f.anterior, f.esta, f.acumulado, f.porEstimar])
      fr.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      fr.getCell(3).alignment = { wrapText: true, vertical: 'top' }
      if (f.esta > 0.005) fr.getCell(6).font = { bold: true }
    }
  }
  ws.eachRow(r => [4, 5, 6, 7, 8].forEach(i => { if (typeof r.getCell(i).value === 'number') r.getCell(i).numFmt = moneda }))
  const t = ws.addRow(['', 'TOTAL', '', ...['monto', 'anterior', 'esta', 'acumulado', 'porEstimar'].map(k => hoja.bloques.reduce((s, b) => s + b[k], 0))])
  t.eachCell(c => { c.font = { bold: true } }); [4, 5, 6, 7, 8].forEach(i => { t.getCell(i).numFmt = moneda })

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  const codigo = (hoja.proyecto || '').split('-')[0]
  a.href = url; a.download = `${codigo}-Estimación ${hoja.numero}.xlsx`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
