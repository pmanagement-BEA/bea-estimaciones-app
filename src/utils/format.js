export function fmtMoney(n, currency = 'MXN') {
  if (n === null || n === undefined || isNaN(n)) n = 0
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}

export function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0
  return (Math.round(n * 10) / 10).toFixed(1) + '%'
}

export function fmtDate(d) {
  if (!d) return '—'
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch (e) {
    return d
  }
}
