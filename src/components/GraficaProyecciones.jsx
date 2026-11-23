import { useState } from 'react'
import { AREAS, COLOR_AREA, textoMes, textoMesCorto } from '../lib/proyecciones'
import { fmtMoney } from '../utils/format'

const corto = v => {
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 1 })} M`
  if (a >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('es-MX')} k`
  return `$${Math.round(v)}`
}
function escala(max) {
  if (max <= 0) return { tope: 1, pasos: [0] }
  const bruto = max / 4, mag = 10 ** Math.floor(Math.log10(bruto))
  const paso = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= bruto)
  const tope = Math.ceil(max / paso) * paso
  return { tope, pasos: Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso) }
}

/**
 * Barras apiladas por mes (Consultoría, Commissioning, Modelación) con una marca de lo estimado de verdad.
 * meses: ['YYYY-MM']; proyectado: { mes: { area: $ } }; estimado: { mes: { area: $ } } (opcional)
 */
export default function GraficaProyecciones({ meses, proyectado, estimado = null, areas = AREAS, moneda = 'MXN', hoy = null, alto = 260 }) {
  const [hover, setHover] = useState(null)
  const W = 860, H = alto, m = { t: 14, r: 12, b: 34, l: 64 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const total = mes => areas.reduce((s, a) => s + (proyectado[mes]?.[a] || 0), 0)
  const real = mes => (estimado ? areas.reduce((s, a) => s + (estimado[mes]?.[a] || 0), 0) : 0)
  const max = Math.max(0, ...meses.map(total), ...meses.map(real))
  const { tope, pasos } = escala(max)
  const y = v => m.t + ih - (v / tope) * ih
  const banda = iw / Math.max(1, meses.length)
  const ancho = Math.max(6, Math.min(34, banda * 0.62))

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
        {areas.map(a => (
          <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_AREA[a] }} />{a}
          </span>
        ))}
        {estimado && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px solid var(--navy)' }} />Estimado (enviado)
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
        aria-label="Proyección de cobro por mes y área" onMouseLeave={() => setHover(null)}>
        {pasos.map(v => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="#E4E7EB" strokeWidth={1} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#7B8794">{corto(v)}</text>
          </g>
        ))}
        {meses.map((mes, i) => {
          const cx = m.l + banda * i + banda / 2
          let base = 0
          const segs = areas.map(a => ({ a, v: proyectado[mes]?.[a] || 0 })).filter(s => s.v > 0)
          const r = real(mes)
          return (
            <g key={mes}>
              <rect x={m.l + banda * i} y={m.t} width={banda} height={ih} fill={hover === mes ? 'rgba(13,27,42,.05)' : 'transparent'}
                onMouseEnter={() => setHover(mes)} />
              {segs.map((s, j) => {
                const y0 = y(base), y1 = y(base + s.v)
                base += s.v
                const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0))
                const ultimo = j === segs.length - 1
                return ultimo
                  ? <path key={s.a} pointerEvents="none" fill={COLOR_AREA[s.a]}
                      d={`M${cx - ancho / 2},${y0} V${y0 - h + Math.min(4, h)} Q${cx - ancho / 2},${y0 - h} ${cx - ancho / 2 + Math.min(4, h)},${y0 - h} H${cx + ancho / 2 - Math.min(4, h)} Q${cx + ancho / 2},${y0 - h} ${cx + ancho / 2},${y0 - h + Math.min(4, h)} V${y0} Z`} />
                  : <rect key={s.a} pointerEvents="none" x={cx - ancho / 2} y={y0 - h} width={ancho} height={h} fill={COLOR_AREA[s.a]} />
              })}
              {estimado && r > 0 && <line pointerEvents="none" x1={cx - ancho / 2 - 4} x2={cx + ancho / 2 + 4} y1={y(r)} y2={y(r)} stroke="var(--navy)" strokeWidth={2} strokeLinecap="round" />}
              <text x={cx} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill={mes === hoy ? '#0F7A37' : '#7B8794'} fontWeight={mes === hoy ? 700 : 400}>
                {textoMesCorto(mes)}
              </text>
            </g>
          )
        })}
        <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="#CBD2D9" strokeWidth={1} />
      </svg>
      {hover && (() => {
        const i = meses.indexOf(hover)
        const izq = ((m.l + banda * i + banda / 2) / W) * 100
        return (
          <div style={{ position: 'absolute', top: 24, left: `${izq}%`, transform: `translateX(${izq > 70 ? '-105%' : '8px'})`, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 6px 18px rgba(0,0,0,.12)', pointerEvents: 'none', minWidth: 210, zIndex: 5 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--navy)' }}>{textoMes(hover)}</div>
            {areas.map(a => (
              <div key={a} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_AREA[a] }} />{a}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(proyectado[hover]?.[a] || 0, moneda)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
              <span>Proyectado</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(total(hover), moneda)}</span>
            </div>
            {estimado && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Estimado (enviado)</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(real(hover), moneda)}</span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
