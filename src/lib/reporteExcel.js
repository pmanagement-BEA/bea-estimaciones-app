// Reporte mensual en formato RC-OP-01 (Excel). ExcelJS se carga solo al usarlo.

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

function fecha(d) {
  if (!d) return ''
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}

/** Acciones realizadas agrupadas por área, en el orden del formato. Las que no traen área van a Consultoría. */
export function accionesPorArea(acciones) {
  return AREAS_REPORTE.map(([area, titulo]) => ({
    area, titulo,
    filas: (acciones || []).filter(a => (a.area || 'Consultoría') === area && ((a.task || '').trim() || (a.descripcion || '').trim())),
  })).filter(g => g.filas.length)
}

/**
 * datos: { proyecto, cliente, ubicacion, numero, periodFrom, rpt, equipo: { lider, cx, me } }
 */
export async function descargarReporteExcel(datos) {
  const ExcelJS = (await import('exceljs')).default
  const { rpt = {}, equipo = {} } = datos
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('RC-OP-01', { pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .2, footer: .2 } } })
  ws.columns = [{ width: 6 }, { width: 30 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 14 }]
  const navy = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A44' } }
  const verde = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EC' } }
  const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
  const borde = { top: { style: 'thin', color: { argb: 'FFBFC5CC' } }, left: { style: 'thin', color: { argb: 'FFBFC5CC' } }, bottom: { style: 'thin', color: { argb: 'FFBFC5CC' } }, right: { style: 'thin', color: { argb: 'FFBFC5CC' } } }
  const envolver = { wrapText: true, vertical: 'top' }

  const fila = (valores, merges = []) => {
    const r = ws.addRow(valores)
    merges.forEach(([a, b]) => ws.mergeCells(r.number, a, r.number, b))
    for (let i = 1; i <= 6; i++) { const c = r.getCell(i); c.border = borde; c.alignment = { ...envolver, ...(c.alignment || {}) } }
    return r
  }
  const titulo = texto => {
    ws.addRow([])
    const r = fila([texto], [[1, 6]])
    r.getCell(1).fill = navy; r.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    return r
  }
  const encabezados = (valores, merges) => {
    const r = fila(valores, merges)
    r.eachCell(c => { c.fill = gris; c.font = { bold: true, size: 9 } })
    return r
  }
  const vacio = texto => { const r = fila([texto], [[1, 6]]); r.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } } }
  // Altura aproximada para que el texto largo no se corte
  const alto = (r, texto, ancho) => { const lineas = String(texto || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / ancho)), 0); r.height = Math.max(15, lineas * 13) }

  ws.mergeCells('A1:E1'); ws.getCell('A1').value = 'REPORTE MENSUAL DE AVANCE'
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F2A44' } }
  ws.getCell('F1').value = 'RC-OP-01'; ws.getCell('F1').font = { bold: true, size: 9 }; ws.getCell('F1').alignment = { horizontal: 'right' }
  ws.addRow([])

  const par = (k1, v1, k2, v2) => {
    const r = fila([k1, '', v1, k2, v2, ''], [[1, 2], [5, 6]])
    r.getCell(1).font = { bold: true, size: 9 }; r.getCell(4).font = { bold: true, size: 9 }
    r.getCell(1).fill = gris; r.getCell(4).fill = gris
  }
  const pct = rpt.avance_documental != null && rpt.avance_documental !== '' ? `${Number(rpt.avance_documental)}%` : ''
  par('MES', mesReporte(datos.periodFrom), 'FECHA', fecha(new Date().toISOString()))
  par('PROYECTO', datos.proyecto, 'CLIENTE', datos.cliente)
  par('FASE', rpt.fase_texto || '', 'ESTADO DE PROYECTO', rpt.estado_proyecto || '')
  par('INICIO DE FASE', fecha(rpt.inicio_fase), 'FINALIZACIÓN DE FASE', fecha(rpt.fin_fase))
  par('INICIO DE CONTRATO', fecha(rpt.inicio_contrato), 'FINALIZACIÓN DE CONTRATO', fecha(rpt.fin_contrato))
  par('% GLOBAL DE AVANCE DOCUMENTAL', pct, 'ESTIMACIÓN', `No. ${datos.numero}`)

  titulo('DISTRIBUCIÓN')
  par('LÍDER DE PROYECTO', equipo.lider || '', 'CLIENTE RESPONSABLE', rpt.cliente_responsable || '')
  par('AUTORIDAD CX', equipo.cx || '', 'MODELACIÓN ENERGÉTICA', equipo.me || '')

  titulo('ACCIONES REALIZADAS EN EL MES')
  const grupos = accionesPorArea(rpt.acciones_realizadas)
  if (!grupos.length) vacio('Sin acciones registradas')
  for (const g of grupos) {
    const h = fila([g.titulo], [[1, 6]]); h.getCell(1).fill = verde; h.getCell(1).font = { bold: true, size: 9 }
    encabezados(['Nº', 'ACCIÓN', '', '', '', 'FECHA'], [[2, 5]])
    g.filas.forEach((a, i) => {
      const lineas = (a.descripcion || '').split('\n').map(l => l.trim()).filter(Boolean)
      const texto = [(a.task || '').trim(), ...lineas.map(l => `• ${l}`)].filter(Boolean).join('\n')
      const r = fila([i + 1, texto, '', '', '', fecha(a.fecha)], [[2, 5]])
      if ((a.task || '').trim()) r.getCell(2).value = { richText: [{ text: a.task.trim(), font: { bold: true } }, ...(lineas.length ? [{ text: '\n' + lineas.map(l => `• ${l}`).join('\n') }] : [])] }
      alto(r, texto, 95)
    })
  }

  titulo('ACCIONES PENDIENTES')
  const pend = (rpt.acciones_pendientes || []).filter(a => (a.accion || '').trim())
  if (!pend.length) vacio('Sin acciones pendientes')
  else {
    encabezados(['Nº', 'ACCIÓN', '', '', 'RESPONSABLE', 'FECHA'], [[2, 4]])
    pend.forEach((a, i) => { const r = fila([i + 1, a.accion, '', '', a.responsable || 'BEA', fecha(a.fecha)], [[2, 4]]); alto(r, a.accion, 75) })
  }

  titulo('INFORMACIÓN PENDIENTE')
  const info = (rpt.informacion_pendiente || []).filter(a => (a.texto || '').trim())
  if (!info.length) vacio('Sin información pendiente')
  else {
    encabezados(['Nº', 'INFORMACIÓN', '', '', 'RESPONSABLE', ''], [[2, 4], [5, 6]])
    info.forEach((a, i) => { const r = fila([i + 1, a.texto, '', '', a.responsable || 'BEA', ''], [[2, 4], [5, 6]]); alto(r, a.texto, 75) })
  }
  if ((rpt.nota_info_pendiente || '').trim()) {
    const r = fila([`Nota: ${rpt.nota_info_pendiente.trim()}`], [[1, 6]]); r.getCell(1).font = { italic: true, size: 9 }; alto(r, rpt.nota_info_pendiente, 110)
  }

  titulo('RIESGOS ACTUALES')
  const riesgos = (rpt.riesgos || []).filter(a => (a.riesgo || '').trim())
  if (rpt.no_riesgos || !riesgos.length) vacio('No hay riesgos actuales')
  else {
    encabezados(['Nº', 'RIESGO', '', '', 'PRERREQUISITOS/CRÉDITOS EN INCUMPLIMIENTO', ''], [[2, 4], [5, 6]])
    riesgos.forEach((a, i) => { const r = fila([i + 1, a.riesgo, '', '', a.creditos || '', ''], [[2, 4], [5, 6]]); alto(r, a.riesgo, 75) })
  }

  titulo('ENTREGABLES SIGNIFICATIVOS BEA / ANEXOS')
  const ent = (rpt.entregables || []).filter(a => (a.texto || '').trim())
  if (!ent.length) vacio('Sin entregables')
  else ent.forEach((a, i) => { const r = fila([i + 1, a.texto], [[2, 6]]); alto(r, a.texto, 110) })

  titulo('RESUMEN DEL PROYECTO')
  const res = (rpt.resumen_proyecto || []).filter(a => (a.hito || '').trim())
  if (!res.length) vacio('Sin hitos registrados')
  else {
    encabezados(['Nº', 'HITO', '', '', '', 'FECHA'], [[2, 5]])
    res.forEach((a, i) => { const r = fila([i + 1, a.hito, '', '', '', fecha(a.fecha)], [[2, 5]]); alto(r, a.hito, 95) })
  }

  ws.eachRow(r => r.eachCell(c => { if (c.col === 1 && typeof c.value === 'number') c.alignment = { horizontal: 'center', vertical: 'top' } }))

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  const codigo = (datos.proyecto || '').split(/[-_]/)[0]
  a.href = url; a.download = `${codigo}-Reporte mensual ${mesReporte(datos.periodFrom)}.xlsx`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
