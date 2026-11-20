// Plantillas de disciplinas y conceptos por tipo de servicio.
// Se cargan solas al elegir el tipo de servicio de un proyecto nuevo (Configuración del proyecto).
// Cada plantilla sale de un proyecto real de BEA del mismo tipo; los % de cada disciplina suman 100.
// mesesF2 = meses de diseño / implementación, mesesF3 = meses de construcción.

const c = (key, description, deliverable, pct, type = 'Normal', month = '') => ({ key, description, deliverable, pct, month, type })
const dos = n => String(n).padStart(2, '0')
const meses = n => Math.max(1, Math.min(60, Number(n) || 1))

// Reparte para que los conceptos de cada tipo sumen exactamente 100% (respeta los pesos;
// el redondeo se ajusta en el último concepto).
export function a100(concepts) {
  const out = concepts.map(x => ({ ...x }))
  for (const tipo of ['Normal', 'Finiquito']) {
    const grupo = out.filter(x => x.type === tipo)
    const total = grupo.reduce((s, x) => s + x.pct, 0)
    if (!grupo.length || total <= 0) continue
    let acumulado = 0
    grupo.forEach((x, i) => {
      x.pct = i === grupo.length - 1 ? Math.round((100 - acumulado) * 1e6) / 1e6 : Math.round((x.pct / total) * 100 * 1e6) / 1e6
      acumulado += x.pct
    })
  }
  return out
}

// Genera las disciplinas + conceptos por defecto del machote BEA.
// mesesF2 = meses de diseño (Fase 2), mesesF3 = meses de construcción (Fase 3 y CX)
export function plantillaLEED(mesesF2 = 8, mesesF3 = 18) {
  const LEED_F2_EST = 387432
  const LEED_F3_EST = 183569.472
  const EH_EST = 17280
  const ME_EST = 172914.759

  const n2 = Math.max(1, Math.min(60, mesesF2))
  const n3 = Math.max(1, Math.min(60, mesesF3))

  const fase2Concepts = []
  for (let i = 1; i <= n2; i++) {
    fase2Concepts.push({ key: `2.b.${String(i).padStart(2, '0')}`, description: `Seguimiento LEED diseño mes ${i}: reunión mensual, revisión de entregables de diseño, asesoría técnica LEED y desarrollo de cálculos`, deliverable: '1. Reporte.', pct: (47520 / LEED_F2_EST) * 100, month: '', type: 'Normal' })
  }
  fase2Concepts.push({ key: '2.09', description: 'Reporte de Revisión de Diseño Final', deliverable: '1. Reporte.', pct: (7272 / LEED_F2_EST) * 100, month: '', type: 'Normal' })

  const fase3Concepts = []
  for (let i = 1; i <= n3; i++) {
    fase3Concepts.push({ key: `3.seg.${String(i).padStart(2, '0')}`, description: `Seguimiento LEED Construcción y Reporte Mensual de Avance - Mes ${i}`, deliverable: '1. Reporte mensual.', pct: (4267.35 / LEED_F3_EST) * 100, month: '', type: 'Normal' })
  }
  for (let mes = 2, b = 1; mes <= n3; mes += 2, b++) {
    fase3Concepts.push({ key: `3.bim.${String(b).padStart(2, '0')}`, description: `Reunión bimensual en sitio — Mes ${mes} de construcción`, deliverable: '1. Reporte de Inspección.', pct: (5637.6 / LEED_F3_EST) * 100, month: '', type: 'Normal' })
  }
  fase3Concepts.push({ key: '3.31', description: 'Plan de Calidad del Ambiente Interior', deliverable: '1. Plan.', pct: (2466.45 / LEED_F3_EST) * 100, month: '', type: 'Normal' })

  const cxConcepts = []
  for (let i = 1; i <= n3; i++) {
    cxConcepts.push({ key: `cx.seg.${String(i).padStart(2, '0')}`, description: `Seguimiento de proyecto mes ${i}`, deliverable: '1. Reporte.', pct: Math.round((100 / (n3 + 3)) * 10) / 10, month: '', type: 'Normal' })
  }
  cxConcepts.push(
    { key: 'cx.fin.01', description: 'Revisión de pruebas pre-funcionales de los sistemas', deliverable: '1. Reporte.', pct: 100 / (n3 + 3), month: '', type: 'Normal' },
    { key: 'cx.fin.02', description: 'Revisión de Pruebas funcionales de los sistemas', deliverable: '1. Reporte.', pct: 100 / (n3 + 3), month: '', type: 'Normal' },
    { key: 'cx.fin.03', description: 'Integración del manual de O&M general y reporte final', deliverable: '1. Documento.', pct: 100 / (n3 + 3), month: '', type: 'Normal' },
  )

  const plantilla = [
    {
      name: 'Fase Uno: Diagnóstico, Factibilidad y Plan de Acción para Certificación LEED',
      concepts: [
        { key: '1.01', description: 'Diagnóstico de sustentabilidad del proyecto: revisión de condiciones del sitio, programa arquitectónico y estrategias de diseño pasivo', deliverable: '1. Reporte de diagnóstico.', pct: 25, month: '', type: 'Normal' },
        { key: '1.02', description: 'Análisis de factibilidad LEED: evaluación de créditos alcanzables, nivel de certificación objetivo y brechas principales', deliverable: '1. Matriz de factibilidad.', pct: 25, month: '', type: 'Normal' },
        { key: '1.03', description: 'Plan Estratégico de Acción LEED: hoja de ruta de créditos, responsables, entregables y cronograma de certificación', deliverable: '1. Plan Estratégico.', pct: 25, month: '', type: 'Normal' },
        { key: '1.04', description: 'Taller de alineación con equipo de diseño: sesión de trabajo para socializar el plan LEED y definir compromisos por disciplina', deliverable: '1. Minuta de taller.', pct: 25, month: '', type: 'Normal' },
      ],
    },
    { name: 'Fase Dos: Asesoría y Gestión LEED Diseño e Ingenierías', concepts: fase2Concepts },
    { name: 'Fase Tres: Asesoría y Gestión LEED Construcción', concepts: fase3Concepts },
    { name: 'Fundamental Commissioning', concepts: cxConcepts },
    {
      name: 'Enhanced Commissioning & Monitoring-Based Commissioning',
      concepts: [
        { key: '5.02', description: 'Revision de submittals de los sistemas', deliverable: '1. Reporte.', pct: (14400 / EH_EST) * 100, month: '', type: 'Normal' },
        { key: '5.03', description: 'Revision de los entrenamientos de los sistemas', deliverable: '1. Reporte.', pct: (1728 / EH_EST) * 100, month: 'TBD', type: 'Normal' },
        { key: '5.04', description: 'Plan de comisionamiento continuo', deliverable: '1. Plan Cx.', pct: (1152 / EH_EST) * 100, month: 'TBD', type: 'Normal' },
      ],
    },
    {
      name: 'Modelación Energética',
      concepts: [
        { key: '6.02a', description: 'Iteracion 2', deliverable: '1. Reporte.', pct: (43809.984 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.04a', description: 'Reunion via remota de revision de reportes - iteracion 2', deliverable: '1. Minuta.', pct: (1422.9 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.05b', description: 'Version 1 de cambios en Modelo Energetico derivados de ajustes en el proyecto arquitectonico', deliverable: '1. Reporte.', pct: (11700 / ME_EST) * 100, month: '', type: 'Normal' },
        { key: '6.06b', description: 'Version 2 de cambios en Modelo Energetico derivados de ajustes en el proyecto arquitectonico', deliverable: '1. Reporte.', pct: (115981.875 / ME_EST) * 100, month: '', type: 'Normal' },
      ],
    },
    {
      name: 'Certificación (FINIQUITO)',
      concepts: [
        { key: '7.01', description: 'Envio a revision preliminar', deliverable: '1. Submittals.', pct: 45, month: '', type: 'Finiquito' },
        { key: '7.02', description: 'Envio a revision final', deliverable: '1. Submittals.', pct: 30, month: '', type: 'Finiquito' },
        { key: '7.03', description: 'Certificacion', deliverable: '1. Certificado.', pct: 25, month: '', type: 'Finiquito' },
      ],
    },
  ]
  return plantilla.map(d => ({ ...d, concepts: a100(d.concepts) }))
}

// ── Piezas comunes ──────────────────────────────────────────────────────────
const finiquitoLEED = n => ({
  name: 'Certificación (FINIQUITO)',
  concepts: [
    c(`${n}.01`, 'Envío a revisión preliminar', '1. Submittals.', 45, 'Finiquito'),
    c(`${n}.02`, 'Envío a revisión final', '1. Submittals.', 30, 'Finiquito'),
    c(`${n}.03`, 'Certificación', '1. Certificado.', 25, 'Finiquito'),
  ],
})
const finiquitoEDGE = n => ({ name: 'Certificación (FINIQUITO)', concepts: [c(`${n}.01`, 'Certificación EDGE', '1. Certificado.', 100, 'Finiquito')] })

const modelacion = n => ({
  name: 'Modelación Energética', area: 'Modelación',
  concepts: [
    c(`${n}.01`, 'Iteración 1', '1. Reporte.', 45),
    c(`${n}.02`, 'Reunión vía remota de revisión de reportes - iteración 1', '1. Minuta.', 5),
    c(`${n}.03`, 'Iteración 2', '1. Reporte.', 45),
    c(`${n}.04`, 'Reunión vía remota de revisión de reportes - iteración 2', '1. Minuta.', 5),
  ],
})

const auditoriaASHRAE = n => ({
  name: 'Auditoría Energética ASHRAE Nivel 1', area: 'Modelación',
  concepts: [
    c(`${n}.01`, 'Visita para Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 30),
    c(`${n}.02`, 'Reporte de resultados preliminares Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 30),
    c(`${n}.03`, 'Reporte de Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 40),
  ],
})

// Commissioning (Fundamental + Enhanced) igual que en la plantilla LEED
const commissioning = (m3) => plantillaLEED(8, m3).filter(d => /commissioning/i.test(d.name)).map(d => ({ ...d, area: 'Commissioning' }))

// ── LEED O+M ────────────────────────────────────────────────────────────────
function plantillaOM(m2) {
  const n = meses(m2)
  const impl = [], aud = []
  for (let i = 1; i <= n; i++) {
    impl.push(c(`2.${dos(i)}`, `Reunión Mensual y Seguimiento de Fase de Implementación Mes ${i}`, '1. Reporte.', 1))
    aud.push(c(`5.${dos(i)}`, `Soporte técnico definición y ejecución de tareas para medidas de eficiencia energética Mes ${i}`, '1. Reporte.', 84 / n))
  }
  aud.push(c(`5.${dos(n + 1)}`, 'Reporte de Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 16))
  return [
    { name: 'Fase Uno: Diagnóstico, Factibilidad y Plan de Acción', concepts: [
      c('1.01', 'Reunión de arranque', '1. Presentación.', 25.8824),
      c('1.02', 'Reunión para cierre de fase', '1. Presentación.', 25.8824),
      c('1.03', 'Informe de Diagnóstico de Proyecto y Checklist para estrategia de certificación LEED O+M', '1. Diagnóstico.', 48.2353),
    ] },
    { name: 'Fase Dos: Implementación del Programa Estratégico & Monitoreo en Periodo de Desempeño', concepts: impl },
    { name: 'Fase Tres: Cierre Técnico - Administrativo', concepts: [
      c('3.01', 'Envío a revisión preliminar', '1. Reporte.', 70),
      c('3.02', 'Envío a revisión final', '1. Reporte.', 30),
    ] },
    { name: 'Fase Uno: Auditoría Energética ASHRAE Nivel 1', area: 'Modelación', concepts: [
      c('4.01', 'Visita para Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 50),
      c('4.02', 'Reporte de resultados preliminares Auditoría Energética Nivel 1 de ASHRAE', '1. Reporte.', 50),
    ] },
    { name: 'Fase Dos: Implementación de Servicios de Auditoría en Energía Nivel 1', area: 'Modelación', concepts: aud },
    { name: 'Pruebas de Calidad del Aire', concepts: [c('6.01', 'Ejecución de Pruebas de Calidad del Aire', '1. Reporte.', 100)] },
    finiquitoLEED(7),
  ]
}

function plantillaRecert(m2) {
  const n = meses(m2)
  const soporte = []
  for (let i = 1; i <= n; i++) soporte.push(c(`2.${dos(i)}`, `Mes de soporte técnico mensual ${i}${i === 1 ? ' (revisión de información)' : ' (incluye reunión remota)'}`, '1. Reporte mensual.', 1))
  return [
    { name: 'Reunión Interdisciplinaria de Arranque', concepts: [c('1.01', 'Reunión Interdisciplinaria de Arranque', '1. Presentación.', 100)] },
    { name: `Soporte Técnico LEED O+M (${n} meses)`, concepts: soporte },
    { name: 'Pruebas Anuales de Calidad del Aire', concepts: [c('3.01', 'Pruebas de Calidad del Aire (TVOCs y CO2)', '1. Reporte.', 100)] },
    { name: 'Cierre documental y proceso de Revisión Externa con GBCI', concepts: [
      c('4.01', 'Envío a revisión preliminar', '1. Submittals.', 45),
      c('4.02', 'Envío a revisión final', '1. Submittals.', 35),
      c('4.03', 'Certificación', '1. Certificación.', 20),
    ] },
    finiquitoLEED(5),
  ]
}

// ── EDGE ────────────────────────────────────────────────────────────────────
const seguimientoEDGE = (n, nMeses, etapa) => {
  const out = [c(`${n}.01`, `Reunión de arranque de Fase de ${etapa}, vía remota.`, '1. Minuta.', 10)]
  for (let i = 1; i <= nMeses; i++) out.push(c(`${n}.${dos(i + 1)}`, `Seguimiento EDGE y Asesoramiento e implementación de Plan Estratégico de Acción EDGE - Mes ${i}`, '1. Reporte mensual.\n2. Minuta.', 80 / nMeses))
  out.push(c(`${n}.${dos(nMeses + 2)}`, `Reunión de Cierre etapa de ${etapa}, vía remota.`, '1. Minuta.', 10))
  return out
}

function plantillaEDGEDiseno(m2, m3) {
  return [
    { name: 'Fase 1: Diagnóstico, Factibilidad y Plan de Acción', concepts: [
      c('1.01', 'Reunión de Arranque de Proyecto, vía remota.', '1. Carta de Arranque.\n2. Presentación.', 25.8824),
      c('1.02', 'Reunión para Cierre de Fase, vía remota.', '1. Presentación.\n2. Minuta.', 25.8824),
      c('1.03', 'Plan de Acción de Certificación EDGE. Incluye Reporte de Recomendaciones y Estrategias a implementar', '1. Reporte.\n2. Checklist.', 48.2353),
    ] },
    { name: 'Fase 2: Consultoría Profesional EDGE para Etapa de Diseño', concepts: seguimientoEDGE(2, meses(m2), 'Diseño') },
    { name: 'Fase 3: Consultoría Profesional EDGE para Etapa de Construcción', concepts: seguimientoEDGE(3, meses(m3), 'Construcción') },
    { name: 'Fase 4: Visita de Inspección Técnica y Soporte para Auditoría EDGE', concepts: [
      c('4.01', 'Visita al sitio Pre-Auditoría EDGE.', '1. Reporte de Pre-Auditoría.', 40),
      c('4.02', 'Reporte de Pre-Auditoría Final EDGE.', '1. Reporte de Pre-Auditoría.', 40),
      c('4.03', 'Reunión de presentación de reporte de Pre-Auditoría Final EDGE.', '1. Minuta.', 20),
    ] },
    { name: 'Auditoría Profesional EDGE para Etapa de Diseño', concepts: [
      c('5.01', 'Reunión remota/presencial de Arranque de Auditoría.', '1. Minuta.', 20),
      c('5.02', 'Reporte de Revisión Inicial de Diseño para Certificado Preliminar EDGE.', '1. Reporte de Auditoría Inicial.', 40),
      c('5.03', 'Reporte de Auditoría Final de Diseño para Certificado Preliminar EDGE.', '1. Reporte de Auditoría.', 40),
    ] },
    { name: 'Auditoría Profesional EDGE para Etapa de Construcción', concepts: [
      c('6.01', 'Visita de Auditoría EDGE.', '1. Minuta.', 50),
      c('6.02', 'Reporte de Auditoría Final de Construcción para Certificación EDGE.', '1. Reporte de Auditoría.', 50),
    ] },
    finiquitoEDGE(7),
  ]
}

function plantillaEDGEExistentes(m2) {
  const n = meses(m2)
  const impl = [c('2.01', 'Reunión interdisciplinaria de Arranque de Fase (Kick-off) con el equipo del cliente (vía remota).', '1. Minuta.', 5)]
  for (let i = 1; i <= n; i++) impl.push(c(`2.${dos(i + 1)}`, `Asesoramiento e implementación EDGE - Mes ${i} (reuniones semanales remotas)`, '1. Reporte mensual.\n2. Minutas.', 90 / n))
  impl.push(c(`2.${dos(n + 2)}`, 'Reunión de Cierre de Fase con el equipo del cliente (vía remota).', '1. Minuta.', 5))
  return [
    { name: 'Fase 1: Diagnóstico, Factibilidad y Desarrollo de Plan Estratégico', concepts: [
      c('1.01', 'Reunión remota de Arranque con equipo del cliente.', '1. Carta de Arranque.\n2. Presentación.', 40),
      c('1.02', 'Reuniones semanales de seguimiento a recepción y status de información. Revisión de evidencias.', '1. Minutas.', 20),
      c('1.03', 'Reporte de Estado de Proyecto EDGE: Diagnóstico.', '1. Reporte Diagnóstico.\n2. Checklist.', 40),
    ] },
    { name: 'Fase 2: Asesoramiento e implementación', concepts: impl },
    { name: 'Auditoría Profesional EDGE para Edificios Existentes', concepts: [c('3.01', 'Reporte de Auditoría Final de EDGE para Edificios Existentes.', '1. Reporte de Auditoría.', 100)] },
    finiquitoEDGE(4),
  ]
}

// ── WELL ────────────────────────────────────────────────────────────────────
function plantillaWELL(m2, m3, nombre) {
  const n2 = meses(m2), n3 = meses(m3)
  const diseno = [
    c('2.01', `Reunión de Arranque de Diseño + Plan de Desarrollo ${nombre} (remota).`, '1. Matriz/Checklist.', 6),
    c('2.02', 'Sesión de Stakeholders (Stakeholder Charrette).', '1. Minuta.', 4),
  ]
  for (let i = 1; i <= n2; i++) diseno.push(c(`2.${dos(i + 2)}`, `Seguimiento WELL Diseño y Reporte Mensual de Desarrollo ${nombre} - Mes ${i}.`, '1. Reporte mensual.', 90 / n2))
  const constr = [c('3.01', 'Reunión Kick-off equipo de Construcción (remota).', '1. Presentación.', 3)]
  for (let i = 1; i <= n3; i++) constr.push(c(`3.${dos(i + 1)}`, `Seguimiento WELL Construcción y Reporte Mensual de Desarrollo ${nombre} - Mes ${i}.`, '1. Reporte/Minuta.', 93 / n3))
  constr.push(
    c(`3.${dos(n3 + 2)}`, 'Bitácora de evidencias en formatos IWBI.', '1. Bitácora.', 2.5),
    c(`3.${dos(n3 + 3)}`, `Carpeta Digital ${nombre}.`, '1. Carpeta ZIP.', 1.5),
  )
  return [
    { name: 'Fase 1: Diagnóstico y Plan de Acción', concepts: [
      c('1.01', 'Reunión de arranque.', '1. Presentación.', 10),
      c('1.02', `Soporte Técnico ${nombre} a equipo del Cliente.`, '1. Presentación.', 20),
      c('1.03', 'Reunión para cierre de fase.', '1. Presentación.', 10),
      c('1.04', 'Matriz de Responsabilidades / Checklist.', '1. Matriz/Checklist.', 15),
      c('1.05', 'Informe de Diagnóstico de Proyecto.', '1. Informe.', 45),
    ] },
    { name: `Fase 2: Asesoría y Gestión ${nombre} - Diseño`, concepts: diseno },
    { name: `Fase 3: Asesoría y Gestión ${nombre} - Construcción`, concepts: constr },
    { name: 'Fase 4: Gestión del Proceso de Revisión de Tercera Parte ante IWBI', concepts: [
      c('4.01', 'Reunión de Cierre con equipo del cliente.', '1. Minuta.', 7),
      c('4.02', `Emisión de Submittals para carga a WELL Online.`, '1. Submittals.', 65),
      c('4.03', 'Seguimiento a conclusiones de revisión de IWBI + gestión de documentación complementaria con Cliente.', '1. Reporte.', 28),
    ] },
    { name: 'Comunicación e Imagen WELL', concepts: [
      c('5.01', 'Soporte Técnico WELL para desarrollo de contenido para publicidad y/o promoción.', '1. Minuta.', 40),
      c('5.02', 'Nota de Prensa.', '1. Nota de Prensa.', 30),
      c('5.03', 'Infografía del proyecto.', '1. Infografía.', 30),
    ] },
    {
      name: 'Certificación (FINIQUITO)',
      concepts: [
        c('6.01', 'Envío a Round 1 de Revisión Documental.', '1. Submittals.', 45, 'Finiquito'),
        c('6.02', 'Envío a Round 2 de Revisión Documental.', '1. Submittals.', 30, 'Finiquito'),
        c('6.03', 'Certificación.', '1. Certificado.', 25, 'Finiquito'),
      ],
    },
  ]
}

// ── Servicios de un solo entregable ─────────────────────────────────────────
const plantillaNOM = () => [{
  name: 'Cumplimiento NOM-ENER (Presupuesto Energético)', area: 'Modelación',
  concepts: [
    c('1.01', 'Cálculo del Presupuesto Energético (Estado Actual).', '1. Reporte.', 25),
    c('1.02', 'Reporte de Hallazgos.', '1. Reporte.', 25),
    c('1.03', 'Matriz de Propiedades Físicas y Térmicas.', '1. Matriz.', 25),
    c('1.04', 'Cálculo del Presupuesto Energético (Actualizado).', '1. Reporte.', 25),
  ],
}]

const plantillaManual = () => [{
  name: 'Manual de lineamientos LEED',
  concepts: [
    c('1.01', 'Reunión de arranque y diagnóstico de requerimientos.', '1. Minuta.', 15),
    c('1.02', 'Borrador del Manual de lineamientos LEED.', '1. Documento.', 45),
    c('1.03', 'Reunión de revisión de comentarios con el cliente.', '1. Minuta.', 10),
    c('1.04', 'Manual de lineamientos LEED final.', '1. Documento.', 30),
  ],
}]

// Claves 1.01, 1.02… / 2.01… según el orden de las disciplinas
const renumerar = lista => lista.map((d, i) => ({ ...d, concepts: d.concepts.map((x, j) => ({ ...x, key: `${i + 1}.${dos(j + 1)}` })) }))

/**
 * Disciplinas de la plantilla para un tipo de servicio, o null si el tipo no tiene plantilla ("Mixto").
 * Cada disciplina: { name, area?, concepts: [{ key, description, deliverable, pct, month, type }] }
 */
export function plantillaServicio(tipo, mesesF2 = 8, mesesF3 = 18) {
  const t = tipo || ''
  let lista
  if (/^LEED O\+M: Recert/.test(t)) lista = plantillaRecert(mesesF2)
  else if (/^LEED O\+M/.test(t)) lista = plantillaOM(mesesF2)
  else if (/^LEED/.test(t)) return plantillaLEED(mesesF2, mesesF3)
  else if (/^EDGE: Edificios existentes/.test(t)) lista = plantillaEDGEExistentes(mesesF2)
  else if (/^EDGE/.test(t)) lista = plantillaEDGEDiseno(mesesF2, mesesF3)
  else if (/^WELL for Residential/.test(t)) lista = plantillaWELL(mesesF2, mesesF3, 'WELL for Residential')
  else if (/^WELL/.test(t)) lista = plantillaWELL(mesesF2, mesesF3, 'WELL')
  else if (t === 'Modelación Energética') lista = [modelacion(1)]
  else if (t === 'Modelación + Auditoría Energética') lista = renumerar([modelacion(1), auditoriaASHRAE(2)])
  else if (t === 'Modelación + Commissioning') lista = renumerar([modelacion(1), ...commissioning(mesesF3)])
  else if (t === 'Comisionamiento') lista = renumerar(commissioning(mesesF3))
  else if (/^NOM/.test(t)) lista = plantillaNOM()
  else if (/^Manual de lineamientos/.test(t)) lista = plantillaManual()
  else return null
  return lista.map(d => ({ ...d, concepts: a100(d.concepts) }))
}

/** Huella de las disciplinas (nombres + conceptos) para saber si siguen como salieron de la plantilla. */
export function huellaDisciplinas(disciplinas) {
  return JSON.stringify((disciplinas || []).map(d => [d.name, (d.concepts || []).map(x => [x.key, x.description, x.deliverable, Math.round((+x.pct || 0) * 1e4), x.type || 'Normal'])]))
}
