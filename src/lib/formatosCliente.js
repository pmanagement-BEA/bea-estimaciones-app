// Estimación en el formato propio del cliente, a partir de la última que se le mandó (plantilla).
// Formatos que se reconocen solos por sus hojas:
//   tec   → Tec de Monterrey: 01 CARÁTULA / 02 DESGLOSE WBS / 03 RESUMEN / 04 ESTADO DE CUENTA
//   stiva → STIVA: CARATULA / ESTIMACION… ("AVANCE ANTERIOR" / "ESTE AVANCE") / EDO DE CTA
//   nemesis → NEMESIS Proyectos: ESTIMACION TIPO / CUERPO EST - Actualizado / CUERPO EST - Anterior
//   gap   → GAP (aeropuertos): Ficha / Estimación - Volúmenes (meses por partida) / Resumen de Partidas…
//           GAP no cobra por concepto: se cobra 1 mes por partida que tuvo avance en el mes.
// En ambos, cada concepto tiene precio unitario, cantidad anterior y cantidad de esta estimación.
// Se mueve "esta" a "anterior", se pone la cantidad nueva, se sube el número y se cambia el periodo.
import { abrirXlsx, colLetra, moverFormula } from './xlsxCeldas.js'

export const NOMBRE_FORMATO = { tec: 'Tec de Monterrey', stiva: 'STIVA', nemesis: 'NEMESIS', gap: 'GAP' }

const n = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0)
const normClave = k => { const s = String(k ?? '').trim().replace(',', '.'); const x = Number(s); return s && !isNaN(x) ? x.toFixed(2) : s.toUpperCase() }
const redondea = x => Math.round(x * 1e6) / 1e6
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function detectarFormato(libro) {
  if (libro.hoja('02 DESGLOSE WBS') && libro.hoja('01 CARÁTULA')) return 'tec'
  if (libro.hoja('CUERPO EST - Actualizado') && libro.hoja('ESTIMACION TIPO')) return 'nemesis'
  if (libro.hoja('Estimación - Volúmenes') && libro.hoja('Ficha')) return 'gap'
  if (libro.hoja(/^ESTIMACI[OÓ]N/i) && libro.hoja(/^CAR[AÁ]TULA/i)) return 'stiva'
  return null
}

/** Celda a la derecha de una etiqueta (busca el texto en la hoja) */
function junto(hoja, re, maxSalto = 6) {
  let ref = null
  hoja.cada((r, col, row, v) => {
    if (ref || typeof v !== 'string' || !re.test(v.trim())) return
    for (let c = col + 1; c <= col + maxSalto; c++) {
      const x = colLetra(c) + row
      if (hoja.valor(x) !== null && hoja.valor(x) !== '') { ref = x; return }
    }
    ref = colLetra(col + 1) + row
  })
  return ref
}

// ── Renglones de concepto de cada formato ───────────────────────────────────
function renglonesTec(libro) {
  const h = libro.hoja('02 DESGLOSE WBS')
  const bloques = []; let actual = null
  const filas = [...h.filas.keys()].sort((a, b) => a - b)
  for (const r of filas) {
    if (r < 15) continue
    const clave = String(h.valor('A' + r) ?? '').trim()
    if (/^\d+\.\d+$/.test(clave)) { actual = []; bloques.push(actual) }
    const pu = n(h.valor('E' + r)); const cant = h.valor('D' + r)
    if (actual && pu > 0 && cant !== null && cant !== '') actual.push({ hoja: h, r, pu, cant: n(cant), colAnt: 'G', colEsta: 'I', clave: null, descripcion: h.valor('B' + r) })
  }
  return bloques.filter(b => b.length)
}

function renglonesStiva(libro) {
  const h = libro.hoja(/^ESTIMACI[OÓ]N/i)
  // Encabezados: "AVANCE ANTERIOR" y "ESTE AVANCE" (cantidad en esas columnas), "P.U."
  let colAnt = null, colEsta = null, colPU = null, filaEnc = 0
  h.cada((ref, col, row, v) => {
    if (typeof v !== 'string') return
    const t = v.trim().toUpperCase()
    if (/^AVANCE ANTERIOR/.test(t)) { colAnt = colLetra(col); filaEnc = row }
    if (/^ESTE AVANCE/.test(t)) colEsta = colLetra(col)
    if (/^P\.?\s?U\.?$/.test(t) && !colPU) colPU = colLetra(col)
  })
  if (!colAnt || !colEsta || !colPU) throw new Error('No encontré las columnas AVANCE ANTERIOR / ESTE AVANCE / P.U. en la hoja de estimación')
  const out = []
  for (const r of [...h.filas.keys()].sort((a, b) => a - b)) {
    if (r <= filaEnc + 1) continue
    const clave = h.valor('A' + r); const pu = n(h.valor(colPU + r))
    if (clave === null || clave === '' || pu <= 0) continue
    out.push({ hoja: h, r, pu, cant: n(h.valor('D' + r)) || 1, colAnt, colEsta, clave: normClave(clave), descripcion: h.valor('B' + r) })
  }
  return [out]
}

function renglonesNemesis(libro) {
  // CUERPO EST: F = P.U., P = cantidad del contrato actualizado, R = acumulado anterior, T = esta estimación
  const h = libro.hoja('CUERPO EST - Actualizado')
  const out = []
  for (const r of [...h.filas.keys()].sort((a, b) => a - b)) {
    if (r <= 23) continue
    const pu = n(h.valor('F' + r)), cant = n(h.valor('P' + r))
    if (pu > 0 && cant > 0 && typeof h.valor('C' + r) === 'string') out.push({ hoja: h, r, pu, cant, colAnt: 'R', colEsta: 'T', clave: null, descripcion: h.valor('C' + r) })
  }
  return out
}

/**
 * plantilla: ArrayBuffer del último Excel que se le mandó al cliente
 * conceptos: [{ clave, disciplina (orden), monto, anterior (fracción cobrada antes), esta (fracción de este mes) }]
 * periodo: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * Devuelve { buffer, tipo, numero, total, sinRenglon, diferencias, renglones }.
 */
export async function generarFormatoCliente(JSZip, plantilla, conceptos, periodo) {
  const libro = await abrirXlsx(JSZip, plantilla)
  const tipo = detectarFormato(libro)
  if (!tipo) throw new Error('No reconozco este formato. Por ahora: Tec de Monterrey, STIVA, NEMESIS y GAP.')
  if (tipo === 'gap') return generarGap(libro, conceptos, periodo)

  // 1. Empatar renglones del archivo con conceptos de la app
  const usados = new Set()
  const conMonto = conceptos.filter(c => c.monto > 0)
  const pares = []
  if (tipo === 'tec') {
    const bloques = renglonesTec(libro)
    const discs = [...new Set(conMonto.map(c => c.disciplina))].sort((a, b) => a - b)
    if (discs.length !== bloques.length) throw new Error(`La app tiene ${discs.length} disciplinas con monto y el archivo del Tec ${bloques.length}`)
    discs.forEach((d, i) => {
      for (const c of conMonto.filter(x => x.disciplina === d)) {
        const w = bloques[i].find(x => !usados.has(x) && Math.abs(x.pu * x.cant - c.monto) < 0.05)
        if (w) { usados.add(w); pares.push([c, w]) }
      }
    })
  } else if (tipo === 'nemesis') {
    // Mismo orden que la app; se empata por importe del contrato actualizado (P.U. × cantidad)
    const filas = renglonesNemesis(libro)
    for (const c of conMonto) {
      const w = filas.find(x => !usados.has(x) && Math.abs(x.pu * x.cant - c.monto) < 1)
      if (w) { usados.add(w); pares.push([c, w]) }
    }
    // La hoja "Anterior" queda como estaba la "Actualizado" antes de esta estimación
    const act = libro.hoja('CUERPO EST - Actualizado'), ant = libro.hoja('CUERPO EST - Anterior')
    if (ant) { ant.filas = new Map([...act.filas].map(([r, f]) => [r, { attrs: f.attrs, celdas: new Map(f.celdas) }])); ant.modificada = true }
  } else {
    const [filas] = renglonesStiva(libro)
    for (const c of conMonto) {
      const k = normClave(c.clave)
      const w = filas.find(x => !usados.has(x) && x.clave === k && Math.abs(x.pu * x.cant - c.monto) < 1)
        || filas.find(x => !usados.has(x) && x.clave === k)
      if (w) { usados.add(w); pares.push([c, w]) }
    }
  }
  const empatados = new Set(pares.map(p => p[0]))
  // Conceptos que se cobran este mes pero no vienen en el archivo (p. ej. van en el archivo de otra fase)
  const sinRenglon = conMonto.filter(c => !empatados.has(c) && c.esta > 0.0001)

  // 2. Revisar que el archivo esté al día: lo cobrado según el archivo = lo cobrado según la app
  const diferencias = []
  for (const [c, w] of pares) {
    const enArchivo = (n(w.hoja.valor(w.colAnt + w.r)) + n(w.hoja.valor(w.colEsta + w.r))) / (w.cant || 1)
    if (Math.abs(enArchivo - c.anterior) > 0.001) diferencias.push({ clave: c.clave, descripcion: w.descripcion, archivo: redondea(enArchivo), app: redondea(c.anterior) })
  }

  // 3. Mover cantidades
  let total = 0
  for (const [c, w] of pares) {
    const ant = n(w.hoja.valor(w.colAnt + w.r)) + n(w.hoja.valor(w.colEsta + w.r))
    w.hoja.escribir(w.colAnt + w.r, redondea(ant))
    const esta = redondea((c.esta || 0) * (w.cant || 1))
    w.hoja.escribir(w.colEsta + w.r, esta || null)
    total += (c.esta || 0) * w.pu * (w.cant || 1)
  }

  // 4. Número y periodo
  const [y1, m1, d1] = periodo.from.split('-').map(Number)
  const [y2, m2, d2] = periodo.to.split('-').map(Number)
  const dd = (d, m, y) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
  let numero
  const fechaSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
  if (tipo === 'nemesis') {
    const et = libro.hoja('ESTIMACION TIPO')
    numero = n(et.valor('I14')) + 1
    et.escribir('I14', numero)
    et.escribir('N14', fechaSerial(y2, m2, d2))  // estimación formulada el
    et.escribir('N15', fechaSerial(y1, m1, d1))  // periodo de ejecución
    et.escribir('P15', fechaSerial(y2, m2, d2))
  } else if (tipo === 'tec') {
    const car = libro.hoja('01 CARÁTULA')
    numero = n(car.valor('D11')) + 1
    car.escribir('D11', numero)
    // El Tec estima del día 11 al 10: se conserva el día y se recorre un mes
    const recorre = t => { const m = String(t ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return t; let [, d, mm, a] = m.map(Number); mm += 1; if (mm > 12) { mm = 1; a += 1 } return dd(d, mm, a) }
    for (const ref of ['K10', 'K11', 'K12']) car.escribir(ref, recorre(car.valor(ref)))
    const edo = libro.hoja('04 ESTADO DE CUENTA')
    for (const r of [...edo.filas.keys()]) {
      const b = n(edo.valor('B' + r))
      if (b === numero - 1 && edo.leer('H' + r)?.formula) edo.escribir('H' + r, n(edo.valor('H' + r)))
      if (b === numero && b > 0) {
        edo.escribir('C' + r, 'Normal'); edo.escribir('D' + r, `Estimación ${numero}`); edo.escribir('G' + r, car.valor('K10'))
        edo.formula('H' + r, "'03 RESUMEN'!E77")
        for (const col of ['I', 'J', 'K', 'L']) if (edo.valor(col + r) === null) edo.escribir(col + r, 0)
      }
    }
  } else {
    const car = libro.hoja(/^CAR[AÁ]TULA/i)
    const refNum = junto(car, /^ESTIMACI[OÓ]N\s*No\.?/i)
    numero = n(car.valor(refNum)) + 1
    car.escribir(refNum, numero)
    const refDe = junto(car, /^(PERIODO\s+)?DE:?$/i), refA = junto(car, /^(A|AL):?$/i)
    const comoTexto = refDe ? typeof car.valor(refDe) === 'string' : false
    const fechaTexto = (y, m, d) => `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${y}`
    if (refDe) car.escribir(refDe, comoTexto ? fechaTexto(y1, m1, d1) : fechaSerial(y1, m1, d1))
    if (refA) car.escribir(refA, comoTexto ? fechaTexto(y2, m2, d2) : fechaSerial(y2, m2, d2))

    // Algunos (JA10) llevan un renglón por estimación en "RESUMEN FINANCIERO" y la carátula apunta a él
    const rf = libro.hoja(/^RESUMEN FINANCIERO/i)
    if (rf) {
      let ultima = null
      for (const r of [...rf.filas.keys()].sort((a, b) => a - b)) {
        if (/^Estimaci[oó]n\s*No/i.test(String(rf.valor('B' + r) ?? '').trim())) ultima = r
      }
      if (ultima) {
        const nueva = ultima + 1
        if (rf.valor('B' + nueva) && String(rf.valor('B' + nueva)).trim()) throw new Error('En RESUMEN FINANCIERO no hay renglón libre después de la última estimación')
        // Monto facturado = total de esta estimación según la hoja de estimación (la misma celda que usa la carátula)
        const refEsta = junto(car, /^ESTA ESTIMACI[OÓ]N$/i)
        const fEsta = refEsta && car.formulaTexto(refEsta)
        const colsConFormula = []
        for (const [col] of rf.filas.get(ultima).celdas) colsConFormula.push(col)
        for (const col of colsConFormula) {
          const letra = colLetra(col)
          const ref = letra + ultima
          const f = rf.formulaTexto(ref)
          if (letra === 'B') rf.escribir('B' + nueva, `Estimación No ${String(numero).padStart(2, '0')}`)
          else if (letra === 'C') rf.escribir('C' + nueva, fechaSerial(y2, m2, d2))
          else if (letra === 'L' && fEsta) rf.formula('L' + nueva, fEsta)
          else if (f) rf.formula(letra + nueva, moverFormula(f, 1))
          else if (typeof rf.valor(ref) === 'number') rf.escribir(letra + nueva, 0)
        }
        // La carátula apunta al renglón nuevo
        car.cada(refC => {
          const f = car.formulaTexto(refC)
          if (f && /RESUMEN FINANCIERO/i.test(f) && new RegExp(`![$]?[A-Z]+[$]?${ultima}\\b`).test(f)) {
            car.formula(refC, f.replace(new RegExp(`(![$]?[A-Z]+[$]?)${ultima}\\b`, 'g'), `$1${nueva}`))
          }
        })
      }
    }
  }

  const buffer = await libro.guardar()
  return { buffer, tipo, numero, total, sinRenglon, diferencias, renglones: pares.length }
}

// ── GAP: meses por partida ───────────────────────────────────────────────────
async function generarGap(libro, conceptos, periodo) {
  const vol = libro.hoja('Estimación - Volúmenes'), ficha = libro.hoja('Ficha')
  const partidas = []
  for (const r of [...vol.filas.keys()].sort((a, b) => a - b)) {
    const wbs = String(vol.valor('B' + r) ?? '').trim()
    const pu = n(vol.valor('N' + r)), meses = n(vol.valor('H' + r))
    if (/^\d+\.\d+$/.test(wbs) && pu > 0 && meses > 0) partidas.push({ r, wbs, pu, meses, descripcion: vol.valor('D' + r) })
  }
  // Disciplinas de la app (con monto) en orden ↔ partidas de GAP (por importe total, si no por orden)
  const discs = new Map()
  for (const c of conceptos.filter(c => c.monto > 0)) {
    const d = discs.get(c.disciplina) || { monto: 0, esta: 0 }
    d.monto += c.monto; d.esta += c.monto * (c.esta || 0); discs.set(c.disciplina, d)
  }
  const lista = [...discs.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d)
  const usados = new Set(); const pares = []
  for (const d of lista) {
    const w = partidas.find(p => !usados.has(p) && Math.abs(p.pu * p.meses - d.monto) < 1) || partidas.find(p => !usados.has(p))
    if (w) { usados.add(w); pares.push([d, w]) }
  }
  let total = 0
  const diferencias = []
  for (const [d, w] of pares) {
    if (Math.abs(w.pu * w.meses - d.monto) >= 1) diferencias.push({ clave: w.wbs, descripcion: w.descripcion, archivo: w.pu * w.meses, app: Math.round(d.monto * 100) / 100 })
    const ant = n(vol.valor('J' + w.r)) + n(vol.valor('K' + w.r))
    const esta = d.esta > 0.005 ? Math.min(1, Math.max(0, w.meses - ant)) : 0
    vol.escribir('J' + w.r, redondea(ant))
    vol.escribir('K' + w.r, esta)
    total += esta * w.pu
  }
  const actual = String(ficha.valor('F36') ?? '')
  const numero = (Number((actual.match(/\d+/) || ['0'])[0]) || 0) + 1
  ficha.escribir('F36', `No. ${String(numero).padStart(2, '0')}`)
  const serial = t => { const [y, m, dd] = t.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000) }
  ficha.escribir('F37', serial(periodo.to))   // fecha de la estimación
  ficha.escribir('G38', serial(periodo.from)) // periodo de ejecución de esta estimación (del…
  ficha.escribir('K38', serial(periodo.to))   // …al)
  const buffer = await libro.guardar()
  return { buffer, tipo: 'gap', numero, total, sinRenglon: [], diferencias, renglones: pares.length }
}
