import { supabase } from '../lib/supabase'

export function aditivaLabel(number) {
  return `Aditiva #${String(number).padStart(3, '0')}`
}

// Siguiente número libre (máximo + 1). Contar filas repite números si se borra una de en medio.
export function nextNumber(rows) {
  return (rows || []).reduce((max, r) => Math.max(max, parseInt(r.number) || 0), 0) + 1
}

/**
 * Cuando una aditiva se acepta, su alcance entra al contrato como una disciplina nueva
 * ("Aditiva #NNN — asunto") con un concepto por alcance. El % de cada concepto sale de su
 * monto, así que se estima, acumula y retiene finiquito igual que el resto del contrato.
 * Es idempotente: si la disciplina ya existe, no la duplica.
 */
export async function incorporarAditivaAlContrato(projectId, aditiva, alcances) {
  const label = aditivaLabel(aditiva.number)
  const { data: discs, error } = await supabase
    .from('disciplines').select('id, name, sort_order').eq('project_id', projectId)
  if (error) return { error }
  if ((discs || []).some(d => (d.name || '').startsWith(label))) return { skipped: true }

  const rows = (alcances || []).filter(al => (parseFloat(al.monto) || 0) > 0 || (al.descripcion || '').trim())
  const total = rows.reduce((s, al) => s + (parseFloat(al.monto) || 0), 0)
  if (total <= 0) return { skipped: true }

  const sortOrder = (discs || []).reduce((m, d) => Math.max(m, d.sort_order || 0), 0) + 1
  const asunto = (aditiva.asunto || '').trim()
  const { data: disc, error: discErr } = await supabase.from('disciplines').insert({
    project_id: projectId,
    name: asunto ? `${label} — ${asunto}` : label,
    monto_total: total,
    descuento: 0,
    tarifa_hh: 0,
    sort_order: sortOrder,
  }).select().single()
  if (discErr) return { error: discErr }

  const num = String(aditiva.number).padStart(3, '0')
  const concepts = rows.map((al, i) => ({
    discipline_id: disc.id,
    key: `AD${num}.${String(i + 1).padStart(2, '0')}`,
    description: al.descripcion || `Alcance ${i + 1}`,
    deliverable: al.entregable || '',
    pct: ((parseFloat(al.monto) || 0) / total) * 100,
    month: '',
    type: 'Normal',
    sort_order: i,
  }))
  const { error: concErr } = await supabase.from('concepts').insert(concepts)
  if (concErr) return { error: concErr }
  return { added: true, total }
}
