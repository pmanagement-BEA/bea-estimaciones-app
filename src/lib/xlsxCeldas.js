// Edición mínima de un .xlsx: solo se tocan los valores de las celdas que se piden.
// Todo lo demás del archivo del cliente (formatos, fórmulas, logos, formas, firmas) queda intacto.
// Las fórmulas pierden su resultado guardado y Excel las recalcula al abrir el archivo.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')

export const colNum = l => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
export const colLetra = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const partir = ref => { const m = ref.match(/^([A-Z]+)(\d+)$/); return { col: colNum(m[1]), row: +m[2] } }

/** Mueve las referencias relativas de una fórmula (como al copiarla dF filas y dC columnas) */
export function moverFormula(texto, dF, dC = 0) {
  // Respeta textos entre comillas dobles; mueve A1, $A1, A$1 (no lo que va con $)
  return texto.split(/("[^"]*"|'[^']*'!)/).map((parte, i) => i % 2 ? parte : parte.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, dc, c, dr, r, off, s) => {
    const antes = s[off - 1]
    if (antes && /[A-Za-z0-9_.]/.test(antes)) return m // parte de un nombre o función
    const col = dc ? c : colLetra(colNum(c) + dC)
    const fila = dr ? r : String(+r + dF)
    return `${dc}${col}${dr}${fila}`
  })).join('')
}

function textoSi(xml) { // <si>…</si> → texto (con o sin formato enriquecido)
  return unesc([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
}

class Hoja {
  constructor(nombre, path, xml, shared) {
    this.nombre = nombre; this.path = path; this.shared = shared; this.modificada = false
    const i = xml.indexOf('<sheetData'); const j = xml.indexOf('</sheetData>')
    if (i < 0) { this.antes = xml; this.despues = ''; this.filas = new Map(); this.sheetDataAbre = ''; return }
    const abre = xml.indexOf('>', i) + 1
    this.antes = xml.slice(0, i); this.sheetDataAbre = xml.slice(i, abre); this.despues = xml.slice(j)
    const cuerpo = j < 0 ? '' : xml.slice(abre, j)
    this.filas = new Map()
    if (xml.slice(i, abre).endsWith('/>')) { this.sheetDataAbre = '<sheetData>'; this.despues = '</sheetData>' + xml.slice(abre) }
    for (const m of cuerpo.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = +m[1].match(/\br="(\d+)"/)[1]
      const celdas = new Map()
      for (const c of (m[3] || '').matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/\br="([A-Z]+\d+)"/)[1]
        celdas.set(partir(ref).col, c[0])
      }
      this.filas.set(r, { attrs: m[1], celdas })
    }
  }

  /** Valor de una celda: número, texto, o { formula, valor } */
  leer(ref) {
    const { col, row } = partir(ref)
    const xml = this.filas.get(row)?.celdas.get(col)
    if (!xml) return null
    const t = (xml.match(/\bt="([^"]+)"/) || [])[1]
    const f = xml.match(/<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/)
    const v = (xml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1]
    let valor = null
    if (t === 's' && v != null) valor = this.shared[+v] ?? ''
    else if (t === 'inlineStr') valor = textoSi(xml)
    else if (t === 'str' || t === 'e') valor = v != null ? unesc(v) : null
    else if (t === 'b') valor = v === '1'
    else if (v != null) valor = Number(v)
    return f ? { formula: f[1] != null ? unesc(f[1]) : '(compartida)', valor } : valor
  }

  /** Valor simple (si es fórmula, su último resultado guardado) */
  valor(ref) { const x = this.leer(ref); return x && typeof x === 'object' ? x.valor : x }

  /** Texto de la fórmula de una celda (resuelve fórmulas compartidas). null si no tiene. */
  formulaTexto(ref) {
    const { col, row } = partir(ref)
    const xml = this.filas.get(row)?.celdas.get(col)
    const f = xml?.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/)
    if (!f) return null
    if (f[2] != null && !/t="shared"/.test(f[1]) ) return unesc(f[2])
    const si = (f[1].match(/\bsi="(\d+)"/) || [])[1]
    if (f[2] != null) return unesc(f[2])
    const maestro = this.maestroCompartido(si)
    return maestro ? moverFormula(maestro.texto, row - maestro.row, col - maestro.col) : null
  }

  maestroCompartido(si) {
    for (const [row, fila] of this.filas) for (const [col, xml] of fila.celdas) {
      const m = xml.match(/<f\b([^>]*\bt="shared"[^>]*)>([\s\S]*?)<\/f>/)
      if (m && (m[1].match(/\bsi="(\d+)"/) || [])[1] === si) return { row, col, texto: unesc(m[2]) }
    }
    return null
  }

  /** Si la celda es la maestra de una fórmula compartida, las demás pasan a tener su fórmula explícita */
  soltarCompartida(ref) {
    const { col, row } = partir(ref)
    const xml = this.filas.get(row)?.celdas.get(col) || ''
    const m = xml.match(/<f\b([^>]*\bt="shared"[^>]*\bref="[^"]*"[^>]*)>([\s\S]*?)<\/f>/)
    if (!m) return
    const si = (m[1].match(/\bsi="(\d+)"/) || [])[1]
    const texto = unesc(m[2])
    for (const [r, fila] of this.filas) for (const [c, x] of fila.celdas) {
      if (r === row && c === col) continue
      const g = x.match(/<f\b[^>]*\bsi="(\d+)"[^>]*\/>/)
      if (g && g[1] === si) fila.celdas.set(c, x.replace(g[0], `<f>${esc(moverFormula(texto, r - row, c - col))}</f>`))
    }
  }

  /** Escribe un número, texto o null (vacío). Reemplaza fórmulas si las hubiera. */
  escribir(ref, valor) {
    this.soltarCompartida(ref)
    const { col, row } = partir(ref)
    let fila = this.filas.get(row)
    if (!fila) { fila = { attrs: ` r="${row}"`, celdas: new Map() }; this.filas.set(row, fila) }
    const previo = fila.celdas.get(col) || ''
    const s = (previo.match(/\bs="(\d+)"/) || [])[1]
    const estilo = s ? ` s="${s}"` : ''
    let xml
    if (valor === null || valor === undefined || valor === '') xml = `<c r="${ref}"${estilo}/>`
    else if (typeof valor === 'number') xml = `<c r="${ref}"${estilo}><v>${Number.isFinite(valor) ? valor : 0}</v></c>`
    else xml = `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`
    fila.celdas.set(col, xml)
    this.modificada = true
  }

  /** Escribe una fórmula (sin resultado; se calcula al abrir) */
  formula(ref, f) {
    this.soltarCompartida(ref)
    const { col, row } = partir(ref)
    const fila = this.filas.get(row) || { attrs: ` r="${row}"`, celdas: new Map() }
    this.filas.set(row, fila)
    const s = ((fila.celdas.get(col) || '').match(/\bs="(\d+)"/) || [])[1]
    fila.celdas.set(col, `<c r="${ref}"${s ? ` s="${s}"` : ''}><f>${esc(f.replace(/^=/, ''))}</f></c>`)
    this.modificada = true
  }

  /** Recorre las celdas con valor: cb(ref, col, row, valor) */
  cada(cb) {
    for (const [row, fila] of [...this.filas].sort((a, b) => a[0] - b[0])) {
      for (const col of [...fila.celdas.keys()].sort((a, b) => a - b)) {
        const ref = colLetra(col) + row
        const v = this.valor(ref)
        if (v !== null && v !== '') cb(ref, col, row, v)
      }
    }
  }

  /** XML final; quita los resultados guardados de las fórmulas para que Excel recalcule */
  xml() {
    const filas = [...this.filas].sort((a, b) => a[0] - b[0]).map(([, f]) => {
      const celdas = [...f.celdas].sort((a, b) => a[0] - b[0]).map(([, c]) =>
        /<f\b/.test(c) ? c.replace(/<v\b[^>]*>[\s\S]*?<\/v>|<v\b[^>]*\/>/, '').replace(/\bt="(str|e|b|n)"/, '') : c).join('')
      return celdas ? `<row${f.attrs}>${celdas}</row>` : `<row${f.attrs}/>`
    }).join('')
    return this.antes + this.sheetDataAbre + filas + this.despues
  }
}

export async function abrirXlsx(JSZip, buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const leerTxt = p => zip.file(p)?.async('string')
  const wbXml = await leerTxt('xl/workbook.xml')
  if (!wbXml) throw new Error('El archivo no es un Excel .xlsx válido (si es .xlsb o .xls, guárdalo como .xlsx)')
  const rels = await leerTxt('xl/_rels/workbook.xml.rels')
  const destino = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]))
  const ssXml = await leerTxt('xl/sharedStrings.xml')
  const shared = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textoSi(m[1])) : []
  const hojas = []
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = unesc(m[0].match(/name="([^"]+)"/)[1])
    const rid = m[0].match(/r:id="([^"]+)"/)[1]
    let path = destino[rid].replace(/^\/?xl\//, '').replace(/^\//, '')
    path = 'xl/' + path.replace(/^xl\//, '')
    hojas.push(new Hoja(nombre, path, await leerTxt(path), shared))
  }
  return {
    zip, hojas,
    hoja: patron => hojas.find(h => typeof patron === 'string' ? h.nombre.trim() === patron : patron.test(h.nombre.trim())),
    async guardar() {
      // Todas las hojas pierden los resultados de fórmulas (dependen de lo que cambió)
      for (const h of hojas) zip.file(h.path, h.xml())
      let wb = wbXml
      if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
      else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
      zip.file('xl/workbook.xml', wb)
      zip.remove('xl/calcChain.xml')
      zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ''))
      const ct = await leerTxt('[Content_Types].xml')
      zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''))
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    },
  }
}
