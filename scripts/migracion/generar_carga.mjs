// Genera el SQL de carga de la migración de Drive a la app. Se puede correr las veces que sea:
//  - Todos los ids son fijos (salen de la clave del proyecto/concepto/mes), así que repetir no duplica.
//  - Nunca sobrescribe: si algo ya existe en la base (lo cargó una corrida anterior o lo capturó
//    alguien en la app) se queda como está.
//  - Lo acumulado hasta el CORTE entra como una sola estimación "saldo al corte"; cada mes posterior
//    del libro entra como su propia estimación. Una estimación no se crea si el proyecto ya tiene
//    una del mismo mes (p. ej. la capturó el líder en la app).
//  - Solo entra lo que cuadra al peso contra el Excel, ya con el redondeo de la base.
//    Lo demás queda en el reporte como pendiente.
//
// Uso: BEA_DUENO=<correo> node generar_carga.mjs <lectura.json> <estado_y_responsables.csv> <colaboradores.csv> <salida.sql> [corte=2026-10]
import fs from 'fs'
import crypto from 'crypto'
import { estimationSummary } from '../../src/utils/calculations.js'
import { aModeloApp } from './conciliar.mjs'
import { leerAjustes, aplicarAjustes } from './ajustes.mjs'

// Ajustes documentados (fuera del repo): BEA_AJUSTES=ruta/ajustes.json
const AJUSTES = leerAjustes(process.env.BEA_AJUSTES)

const TOL = 1
// Correo del perfil coordinador que queda como dueño técnico de los proyectos migrados.
// Se pasa por variable de entorno para no publicar correos en el repo: BEA_DUENO=correo node generar_carga.mjs …
const DUENO = process.env.BEA_DUENO || ''
const NS = 'bea-migracion-2026'

// ── utilidades ────────────────────────────────────────────────────────────────
export function uid(...partes) {
  const h = crypto.createHash('sha1').update(NS + '|' + partes.join('|')).digest()
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const r6 = n => Math.round((n || 0) * 1e6) / 1e6
const r2 = n => Math.round((n || 0) * 100) / 100
const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
const ultimoDia = p => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }

function csv(path) {
  const txt = fs.readFileSync(path, 'utf8').replace(/^﻿/, '')
  const rows = []; let row = [], cur = '', inq = false
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]
    if (inq) { if (ch === '"' && txt[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') inq = false; else cur += ch }
    else if (ch === '"') inq = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  const [h, ...data] = rows.filter(r => r.length > 1)
  return data.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

// Clave de proyecto: "612", "583", "564-chalco"…
export function claveDeArchivo(archivo) {
  return archivo.split('/').pop().replace(/\.xlsx$/, '').replace(/-bea$/, '')
}
function claveDeProyecto(nombre) {
  const n = nombre.slice(0, 3)
  const sitio = nombre.split('·')[1]
  const slug = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return sitio ? `${n}-${slug(sitio)}` : n
}

// ── modelo por libro ─────────────────────────────────────────────────────────
// Estructura (del último mes) con ids fijos + estimaciones (corte + meses posteriores).
export function modeloCarga(libro, corte, porMontos = false) {
  const pk = claveDeArchivo(libro.archivo)
  const m = aModeloApp(libro, { porMontos })
  const ult = libro.meses.at(-1)
  const vistos = {}
  const idDisc = [], idConc = []
  const disciplinas = m.disciplines.map((d, i) => {
    const dl = ult.disciplinas[i]
    const kd = `${dl.clave}|${norm(dl.nombre).slice(0, 40)}`
    vistos[kd] = (vistos[kd] || 0) + 1
    const did = uid('disc', pk, kd, vistos[kd])
    idDisc.push(did)
    const cvist = {}
    const conceptos = d.concepts.map((c, j) => {
      cvist[c.key] = (cvist[c.key] || 0) + 1
      const cid = uid('conc', pk, kd, vistos[kd], c.key, cvist[c.key])
      ;(idConc[i] ||= [])[j] = cid
      return { ...c, id: cid, pct: r6(c.pct) }
    })
    return { ...d, id: did, monto_total: r2(d.monto_total), descuento: r6(d.descuento), concepts: conceptos }
  })
  const rates = { anticipoPct: r6(m.rates.anticipoPct), finiquitoPct: r6(m.rates.finiquitoPct) }

  // Mapa (disciplina, concepto) de cualquier hoja → concepto de la estructura final
  const llave = (d, c, nd, nc) => `${d.clave}|${norm(d.nombre).slice(0, 40)}|${nd}|${c.clave}|${nc}`
  const mapa = {}
  { const vd = {}; ult.disciplinas.forEach((d, i) => {
    const kd = `${d.clave}|${norm(d.nombre).slice(0, 40)}`; vd[kd] = (vd[kd] || 0) + 1
    const vc = {}; d.conceptos.forEach((c, j) => { vc[c.clave] = (vc[c.clave] || 0) + 1; mapa[llave(d, c, vd[kd], vc[c.clave])] = disciplinas[i].concepts[j] })
  }) }
  const recorrer = (hoja, fn) => {
    const vd = {}
    hoja.disciplinas.forEach(d => {
      const kd = `${d.clave}|${norm(d.nombre).slice(0, 40)}`; vd[kd] = (vd[kd] || 0) + 1
      const vc = {}; d.conceptos.forEach(c => { vc[c.clave] = (vc[c.clave] || 0) + 1; fn(c, mapa[llave(d, c, vd[kd], vc[c.clave])]) })
    })
  }

  const meses = libro.meses
  const hastaCorte = meses.filter(x => x.periodo <= corte)
  const despues = meses.filter(x => x.periodo > corte)
  const estimaciones = []
  const faltantes = []
  const item = (estId, concept, frac) => {
    const parcial = frac < 0.9999
    return { id: uid('item', estId, concept.id), estimation_id: estId, concept_id: concept.id, included: true,
      parcial_enabled: parcial, pct_parcial: parcial ? r6(frac * 100) : 0 }
  }
  if (hastaCorte.length) {
    const h = hastaCorte.at(-1)
    const eid = uid('est', pk, 'corte', h.periodo)
    const items = []
    recorrer(h, (c, concept) => {
      const frac = Math.min(1, (c.marca_anterior || 0) + (c.marca_esta || 0))
      if (!(frac > 0.00001)) return
      if (!concept) { faltantes.push(`${h.hoja}: ${c.clave}`); return }
      items.push(item(eid, concept, frac))
    })
    estimaciones.push({ id: eid, number: h.numero ?? hastaCorte.length, periodo: h.periodo, hoja: h.hoja, tipo: 'corte', items, excel: h.encabezado })
  }
  despues.forEach((h, k) => {
    const eid = uid('est', pk, 'mes', h.periodo)
    const items = []
    recorrer(h, (c, concept) => {
      if (!((c.marca_esta || 0) > 0.00001)) return
      if (!concept) { faltantes.push(`${h.hoja}: ${c.clave}`); return }
      items.push(item(eid, concept, Math.min(1, c.marca_esta)))
    })
    estimaciones.push({ id: eid, number: (hastaCorte.at(-1)?.numero ?? hastaCorte.length) + k + 1, periodo: h.periodo, hoja: h.hoja, tipo: 'mes', items, excel: h.encabezado })
  })

  // Verificación: después de cada estimación, el acumulado de la app (ya redondeado) = acumulado del Excel
  const appEsts = estimaciones.map(e => ({ id: e.id, number: e.number, status: 'Enviada', created_at: `${e.periodo}-15T00:00:00Z`, estimation_items: e.items }))
  const checks = estimaciones.map((e, n) => {
    const s = estimationSummary(disciplinas, appEsts.slice(0, n + 1), e.id, Object.fromEntries(e.items.map(i => [i.concept_id, i])), rates)
    const xl = e.excel.acumulado_global
    return { hoja: e.hoja, periodo: e.periodo, app: r2(s.acumGlobal), excel: xl == null ? null : r2(xl), dif: xl == null ? null : r2(s.acumGlobal - xl), porEstimarApp: r2(s.porEstimar) }
  })
  const cuadra = checks.length > 0 && faltantes.length === 0 && checks.every(c => c.dif !== null && Math.abs(c.dif) <= TOL)
  return { pk, rates, disciplinas, estimaciones, checks, cuadra, faltantes, avisos: m.avisos, modo: porMontos ? 'montos' : 'pct' }
}

export function mejorModelo(libro, corte) {
  const a = modeloCarga(libro, corte, false)
  if (a.cuadra) return a
  const b = modeloCarga(libro, corte, true)
  return b.cuadra ? b : a
}

// ── SQL ──────────────────────────────────────────────────────────────────────
function sqlProyecto({ id, nombre, status, rates, team, origen, nota, moneda = 'MXN' }) {
  return `insert into projects (id, user_id, name, status, currency, anticipo_pct, finiquito_pct, team, origen_datos, nota_migracion)
select ${q(id)}, (select id from profiles where email = ${q(DUENO)}), ${q(nombre)}, ${q(status)}, ${q(moneda)}, ${rates.anticipoPct}, ${rates.finiquitoPct},
  ${q(JSON.stringify(team))}::jsonb, ${q(origen)}, ${q(nota)}
where not exists (select 1 from projects where name = ${q(nombre)} and id <> ${q(id)})
on conflict (id) do nothing;`
}
const siProyecto = id => `exists (select 1 from projects where id = ${q(id)})`

function sqlEstructura(pid, mod) {
  const out = []
  mod.disciplinas.forEach(d => {
    out.push(`insert into disciplines (id, project_id, name, monto_total, descuento, tarifa_hh, sort_order)
select ${q(d.id)}, ${q(pid)}, ${q(d.name)}, ${d.monto_total}, ${d.descuento}, 0, ${d.sort_order} where ${siProyecto(pid)} on conflict (id) do nothing;`)
    if (!d.concepts.length) return
    out.push(`insert into concepts (id, discipline_id, key, description, deliverable, pct, month, type, sort_order)
select v.* from (values
${d.concepts.map(c => `  (${q(c.id)}::uuid, ${q(d.id)}::uuid, ${q(c.key)}, ${q(c.description)}, ${q(c.deliverable || '')}, ${c.pct}::numeric, ${q(c.month || '')}, ${q(c.type)}, ${c.sort_order})`).join(',\n')}
) v(id, discipline_id, key, description, deliverable, pct, month, type, sort_order)
where exists (select 1 from disciplines where id = ${q(d.id)}) on conflict (id) do nothing;`)
  })
  return out.join('\n')
}

function sqlEstimaciones(pid, mod) {
  return mod.estimaciones.map(e => {
    const s = [`insert into estimations (id, project_id, number, status, period_from, period_to, report_sent, report_sent_at)
select ${q(e.id)}, ${q(pid)}, ${e.number}, 'Enviada', ${q(e.periodo + '-01')}, ${q(ultimoDia(e.periodo))}, true, ${q(ultimoDia(e.periodo) + 'T23:00:00Z')}
where ${siProyecto(pid)} and not exists (select 1 from estimations where project_id = ${q(pid)} and period_from = ${q(e.periodo + '-01')} and id <> ${q(e.id)})
on conflict (id) do nothing;`]
    if (e.items.length) s.push(`insert into estimation_items (id, estimation_id, concept_id, included, parcial_enabled, pct_parcial)
select v.* from (values
${e.items.map(i => `  (${q(i.id)}::uuid, ${q(i.estimation_id)}::uuid, ${q(i.concept_id)}::uuid, true, ${i.parcial_enabled}, ${i.pct_parcial}::numeric)`).join(',\n')}
) v(id, estimation_id, concept_id, included, parcial_enabled, pct_parcial)
where exists (select 1 from estimations where id = ${q(e.id)}) on conflict do nothing;`)
    return s.join('\n')
  }).join('\n')
}

function sqlMiembros(pid, miembros) {
  if (!miembros.length) return ''
  return `insert into project_members (project_id, rol, email)
select ${q(pid)}, v.rol, v.email from (values ${miembros.map(m => `(${q(m.rol)}, ${q(m.email)})`).join(', ')}) v(rol, email)
where ${siProyecto(pid)} on conflict do nothing;`
}

// ── principal ────────────────────────────────────────────────────────────────
export function generar({ lectura, estadoCsv, colabCsv, corte = '2026-10' }) {
  if (!DUENO) throw new Error('Falta BEA_DUENO (correo del coordinador dueño de los proyectos migrados)')
  // lectura puede ser varias rutas separadas por coma (libros BEA + formatos del cliente)
  const libros = lectura.split(',').flatMap(p => JSON.parse(fs.readFileSync(p, 'utf8')))
  const filas = csv(estadoCsv)
  const colab = csv(colabCsv)
  const email = nombre => colab.find(p => norm(p.Nombre) === norm(nombre))?.Correo?.toLowerCase() || null
  const STATUS = { ACTIVO: 'Activo', 'EN PAUSA': 'Pausado', TERMINADO: 'Terminado' }

  const sql = [`-- Carga de migración BEA — generada ${new Date().toISOString()} — corte ${corte}`,
    '-- Se puede correr varias veces: no duplica ni sobrescribe.', 'begin;',
    `do $$ begin if not exists (select 1 from profiles where email = ${q(DUENO)}) then raise exception 'No existe el perfil ${DUENO}'; end if; end $$;`]
  const reporte = []

  for (const f of filas) {
    const pk = claveDeProyecto(f.Proyecto)
    const origen = f['Origen datos']
    const ajuste = AJUSTES[pk]
    const libroLeido = libros.find(l => claveDeArchivo(l.archivo) === pk && l.meses.length)
    const libro = libroLeido && aplicarAjustes(libroLeido, ajuste)
    const responsables = [['lider', f['Consultoría']], ['cx', f.Commissioning], ['me', f['Modelación']]]
      .filter(([, n]) => n && /[a-z]/i.test(n) && !/no contratado|terminado|sin responsable/i.test(n))
    const miembros = responsables.map(([rol, n]) => ({ rol, email: email(n), nombre: n })).filter(m => m.email)
    const team = { lider: '', cx: '', me: '', consultor: '', coordinador: '' }
    miembros.forEach(m => { team[m.rol] = m.nombre })
    const pid = uid('proy', pk)
    const base = { id: pid, nombre: f.Proyecto, team }

    if (origen === 'sin_estimaciones') {
      sql.push(`\n-- ${f.Proyecto} · sin estimaciones`)
      sql.push(sqlProyecto({ ...base, status: 'Pausado', rates: { anticipoPct: 10, finiquitoPct: 5 }, origen: 'sin_estimaciones',
        nota: `No se encontraron estimaciones en Drive (revisión ${new Date().toISOString().slice(0, 10)}). ${f['Cómo se carga'] || ''}`.trim() }))
      sql.push(sqlMiembros(pid, miembros))
      reporte.push({ proyecto: f.Proyecto, resultado: 'CARGA (vacío)', detalle: 'Sin estimaciones: alta vacía con aviso' })
      continue
    }
    const esCliente = origen === 'formato_cliente' && libro?.formato === 'cliente'
    if ((origen !== 'libro' && !esCliente) || !libro) {
      reporte.push({ proyecto: f.Proyecto, resultado: 'PENDIENTE', detalle: origen === 'formato_cliente' ? 'Falta importador de formato del cliente' : 'Libro no disponible (descarga manual o sin meses)' })
      continue
    }
    const mod = mejorModelo(libro, corte)
    if (!mod.cuadra) {
      const mal = mod.checks.find(c => c.dif === null || Math.abs(c.dif) > TOL)
      reporte.push({ proyecto: f.Proyecto, resultado: 'PENDIENTE', detalle: mod.faltantes.length ? `Conceptos sin pareja: ${mod.faltantes.slice(0, 3).join(', ')}` : `No cuadra en ${mal?.hoja}: app ${mal?.app} vs Excel ${mal?.excel} (dif ${mal?.dif})` })
      continue
    }
    const status = STATUS[f.Estado] || 'Pausado'
    sql.push(`\n-- ${f.Proyecto} · ${libro.archivo.split('/').pop()} · ${mod.estimaciones.map(e => e.hoja).join(' + ')}`)
    sql.push(sqlProyecto({ ...base, status, rates: mod.rates, origen: esCliente ? 'formato_cliente' : 'libro', moneda: libro.moneda || 'MXN',
      nota: `Importado de ${libro.archivo.split('/').pop()}${esCliente ? ' (formato del cliente: CARÁTULA + SOPORTE EST.)' : ''} (${mod.estimaciones.map(e => `${e.tipo === 'corte' ? 'saldo al corte' : 'estimación'} ${e.hoja}`).join('; ')}). Conciliado al peso contra el Excel.${mod.modo === 'montos' ? ' Montos de conceptos tomados del Excel.' : ''}${ajuste?.evidencia ? ` Ajuste documentado: ${ajuste.evidencia}` : ''}` }))
    sql.push(sqlEstructura(pid, mod))
    sql.push(sqlEstimaciones(pid, mod))
    sql.push(sqlMiembros(pid, miembros))
    reporte.push({ proyecto: f.Proyecto, resultado: 'CARGA', detalle: mod.checks.map(c => `${c.periodo}: ${c.app}`).join(' · '), sinCorreo: responsables.filter(([, n]) => !email(n)).map(([, n]) => n) })
  }
  sql.push('commit;')
  return { sql: sql.join('\n'), reporte }
}

if (process.argv[1]?.endsWith('generar_carga.mjs') && process.argv[5]) {
  const [, , lectura, estadoCsv, colabCsv, salida, corte] = process.argv
  const { sql, reporte } = generar({ lectura, estadoCsv, colabCsv, corte })
  fs.writeFileSync(salida, sql)
  fs.writeFileSync(salida.replace(/\.sql$/, '_reporte.json'), JSON.stringify(reporte, null, 1))
  const n = k => reporte.filter(r => r.resultado === k).length
  console.log(`CARGA ${n('CARGA')} · VACÍOS ${n('CARGA (vacío)')} · PENDIENTES ${n('PENDIENTE')}  →  ${salida}`)
  reporte.filter(r => r.resultado === 'PENDIENTE').forEach(r => console.log('  pendiente', r.proyecto.slice(0, 45).padEnd(45), r.detalle))
  const sc = reporte.flatMap(r => r.sinCorreo || []); if (sc.length) console.log('  responsables sin correo en directorio:', [...new Set(sc)].join(', '))
}
