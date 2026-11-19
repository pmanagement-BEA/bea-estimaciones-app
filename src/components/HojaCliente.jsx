import { fmtMoney } from '../utils/format'
import { armarHoja } from '../lib/hoja'
export { armarHoja }
export { descargarEstimacionBea as descargarExcel } from '../lib/estimacionExcel'
import { numerosDisciplina } from '../lib/estimacionExcel'

const BASE = import.meta.env.BASE_URL || '/'
const borde = '1px solid #000'
const fino = '1px dotted #999'
const celda = { border: borde, padding: '3px 6px', verticalAlign: 'middle' }
const enc = { ...celda, background: '#D8D8D8', color: '#000', textAlign: 'center', fontWeight: 400, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0, position: 'static' }
const num = { textAlign: 'center', whiteSpace: 'nowrap' }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesAnio = d => (d ? `${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : 'TBD')
const pctCorto = v => `${Math.round((Number(v) || 0) * 100) / 100}%`
const pct2 = v => (v == null ? 'NA' : `${(Math.round(v * 100) / 100).toFixed(2)}%`)

function periodoTexto(desde, hasta) {
  if (!desde || !hasta) return ''
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const dd = n => String(n).padStart(2, '0')
  if (y1 === y2 && m1 === m2) return `Del ${dd(d1)} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
  if (y1 === y2) return `Del ${dd(d1)} de ${MESES[m1 - 1]} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
  return `Del ${dd(d1)} de ${MESES[m1 - 1]} de ${y1} al ${dd(d2)} de ${MESES[m2 - 1]} de ${y2}`
}

/** Vista imprimible en formato RC-OP-11 "ESTIMACIÓN DE AVANCE" (PDF con el botón de imprimir del navegador). */
export default function HojaCliente({ hoja }) {
  const m = v => fmtMoney(v, hoja.moneda)
  const t = hoja.totales || {}
  const hoy = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
  const estimablePct = 100 - (hoja.anticipoPct || 0) - (hoja.finiquitoPct || 0)
  const conFases = hoja.bloques.some(b => b.construccion)
  let fase = null
  const numeros = numerosDisciplina(hoja.bloques)
  const resumen = [
    ['IMPORTE TOTAL', m(t.importe), 'ACUMULADO ANTERIOR', m(t.acumAnterior), '% AVANCE ESTA ESTIMACIÓN', pct2(t.avanceEsta)],
    [`ANTICIPO (${pctCorto(hoja.anticipoPct)})`, t.anticipo > 0.005 ? m(t.anticipo) : 'NA', 'ESTIMACIÓN ACTUAL', m(t.actual), '% DE AVANCE GLOBAL DE PROYECTO', pct2(t.avanceGlobal)],
    [`FINIQUITO (${pctCorto(hoja.finiquitoPct)})`, t.finiquito > 0.005 ? m(t.finiquito) : 'NA', 'ACUMULADO GLOBAL', m(t.acumGlobal), '% AVANCE LEED', pct2(t.avanceArea?.['Consultoría'])],
    [`IMPORTE ESTIMABLE (${pctCorto(estimablePct)})`, m(t.estimable), 'POR ESTIMAR', m(t.porEstimar), '% AVANCE COMMISSIONING', pct2(t.avanceArea?.Commissioning)],
    ['IMPORTE ESTIMABLE ADICIONAL', 'NA', '', '', '% AVANCE MODELACIÓN ENERGÉTICA', pct2(t.avanceArea?.['Modelación'])],
  ]
  return (
    <div className="hoja-cliente" style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 18, fontFamily: 'Montserrat, Arial, sans-serif', color: '#000', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 10 }}>
        <tbody>
          <tr>
            <td rowSpan={3} style={{ ...celda, width: '22%', textAlign: 'center' }}><img src={`${BASE}formatos/logo-bea.png`} alt="BEA" style={{ maxWidth: '100%', maxHeight: 64 }} /></td>
            <td colSpan={2} style={{ ...celda, textAlign: 'center', fontSize: 16 }}>ESTIMACIÓN DE AVANCE</td>
            <td style={{ ...celda, fontSize: 10, whiteSpace: 'nowrap' }}>RC-OP-11 Rev.3-06/22</td>
            <td style={{ ...celda, fontSize: 10, whiteSpace: 'nowrap' }}>{hoy}</td>
          </tr>
          <tr>
            <td style={{ ...celda, textAlign: 'center' }}>Proyecto: {hoja.proyecto}</td>
            <td style={{ ...celda, textAlign: 'center' }}>Cliente: {hoja.cliente || ''}</td>
            <td colSpan={2} style={{ ...celda, fontSize: 10, padding: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px', borderBottom: borde }}><span>FECHA DE INICIO:</span><span>{mesAnio(hoja.inicio)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px' }}><span>FECHA DE TERMINACIÓN:</span><span>{mesAnio(hoja.fin)}</span></div>
            </td>
          </tr>
          <tr>
            <td style={{ ...celda, textAlign: 'center' }}>Ubicación: {hoja.ubicacion || ''}</td>
            <td style={{ ...celda, textAlign: 'center' }}>TIPO DE MONEDA: {hoja.moneda}</td>
            <td colSpan={2} style={{ ...celda, textAlign: 'center', fontSize: 10 }}>PERIODO DE ESTIMACIÓN:<br />{periodoTexto(hoja.periodFrom, hoja.periodTo)}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
        <tbody>{resumen.map(([k1, v1, k2, v2, k3, v3], i) => (
          <tr key={k1} style={{ borderBottom: '1px solid #ddd' }}>
            <td style={{ padding: '2px 6px', fontSize: i === 4 ? 9 : 11 }}>{k1}</td>
            <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{v1}</td>
            <td style={{ padding: '2px 6px', fontWeight: i === 1 ? 700 : 400, fontStyle: i === 1 ? 'italic' : 'normal' }}>{k2}</td>
            <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: i === 1 ? 700 : 400, fontStyle: i === 1 ? 'italic' : 'normal' }}>{v2}</td>
            <td style={{ padding: '2px 6px', fontStyle: i >= 2 ? 'italic' : 'normal' }}>{k3}</td>
            <td style={{ padding: '2px 6px', textAlign: 'center', fontStyle: i >= 2 ? 'italic' : 'normal' }}>{v3}</td>
          </tr>
        ))}</tbody>
      </table>

      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...enc, width: 55 }}>Clave</th><th style={enc}>Concepto</th><th style={{ ...enc, width: 120 }}>Entregable</th>
            <th style={enc}>MONTO</th><th style={enc} colSpan={2}>ANTERIOR</th><th style={enc} colSpan={2}>ESTIMADO ESTA ESTIMACIÓN</th>
            <th style={enc}>ACUMULADO</th><th style={enc}>POR ESTIMAR</th>
          </tr>
        </thead>
        <tbody>
          {hoja.bloques.flatMap((b, bi) => {
            const out = []
            const f = b.construccion ? 'CONSTRUCCIÓN' : 'DISEÑO'
            if (conFases && !b.finiquito && f !== fase) {
              fase = f
              out.push(<tr key={'fase' + bi}><td colSpan={10} style={{ ...celda, background: '#76923C', textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{f}</td></tr>)
            }
            const fin = b.finiquito
            const verde = { ...celda, background: '#EAF1DD', fontSize: 11 }
            out.push(
              <tr key={'b' + bi}>
                <td style={{ ...verde, textAlign: 'center' }}>{numeros[bi]}</td>
                <td colSpan={2} style={verde}>{b.nombre}</td>
                <td style={{ ...verde, ...num }}>{fin ? 'FINIQUITO' : m(b.monto)}</td>
                <td colSpan={2} style={{ ...verde, ...num }}>{fin ? 'FINIQUITO' : m(b.anterior)}</td>
                <td colSpan={2} style={{ ...verde, ...num }}>{fin ? 'FINIQUITO' : m(b.esta)}</td>
                <td style={{ ...verde, ...num }}>{fin ? 'FINIQUITO' : m(b.acumulado)}</td>
                <td style={{ ...verde, ...num }}>{fin ? 'FINIQUITO' : m(b.porEstimar)}</td>
              </tr>,
            )
            b.filas.forEach((r, i) => {
              const c = { borderLeft: borde, borderRight: borde, borderBottom: fino, padding: '2px 6px' }
              const cap = { ...c, ...num, background: '#FFF2DC' }
              const pa = r.monto > 0 ? r.anterior / r.monto : 0
              const pe = r.monto > 0 ? r.esta / r.monto : 0
              out.push(
                <tr key={'f' + bi + '-' + i}>
                  <td style={{ ...c, textAlign: 'center' }}>{r.clave}</td>
                  <td style={c}>{r.concepto}</td>
                  <td style={{ ...c, whiteSpace: 'pre-line', fontSize: 9 }}>{r.entregable}</td>
                  <td style={{ ...c, ...num }}>{r.finiquito ? 'FINIQUITO' : m(r.monto)}</td>
                  <td style={cap}>{pa.toFixed(2)}</td>
                  <td style={{ ...c, ...num }}>{r.finiquito ? 'NA' : m(r.anterior)}</td>
                  <td style={{ ...cap, background: r.esta > 0.005 ? '#C6EFCE' : '#FFF2DC' }}>{pe.toFixed(2)}</td>
                  <td style={{ ...c, ...num, fontWeight: r.esta > 0.005 ? 700 : 400 }}>{m(r.esta)}</td>
                  <td style={{ ...c, ...num }}>{r.finiquito ? 'NA' : m(r.acumulado)}</td>
                  <td style={{ ...c, ...num }}>{r.finiquito ? 'NA' : m(r.porEstimar)}</td>
                </tr>,
              )
            })
            return out
          })}
          {(() => {
            const bs = hoja.bloques.filter(b => !b.finiquito)
            const s = k => bs.reduce((x, b) => x + b[k], 0)
            const g = { ...celda, background: '#D8D8D8', fontSize: 11, ...num }
            return (
              <tr>
                <td colSpan={3} style={{ ...g, textAlign: 'right' }}>SUMA TOTALES</td>
                <td style={g}>{m(s('monto'))}</td><td colSpan={2} style={g}>{m(s('anterior'))}</td><td colSpan={2} style={g}>{m(s('esta'))}</td>
                <td style={g}>{m(s('acumulado'))}</td><td style={g}>{m(s('porEstimar'))}</td>
              </tr>
            )
          })()}
        </tbody>
      </table>
    </div>
  )
}
