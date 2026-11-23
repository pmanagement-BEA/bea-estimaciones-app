import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './Toast'
import { fmtMoney } from '../utils/format'
import {
  AREAS, mesIso, sumarMeses, textoMes, mesFactura, rangoMeses, prepararProyecto, conceptosPorEstimar, estaCongelada, textoCongelamiento,
} from '../lib/proyecciones'

/** Meses que todavía se pueden proyectar: de este mes a 18 meses, sin los congelados (desde el 15 o el siguiente hábil). */
export const mesesAbiertos = () => { const hoy = mesIso(new Date()); return rangoMeses(hoy, sumarMeses(hoy, 18)).filter(m => !estaCongelada(m)) }

/**
 * Formulario para agregar o cambiar una proyección.
 * proyectos: proyectos con disciplines(concepts) y estimations(estimation_items) que se pueden elegir;
 * inicial: { project_id, mes, id?, concept_id?, area?, descripcion?, monto?, tbd? }; proyecciones: las que ya existen
 * (para no repetir un concepto en el mismo mes). onGuardado() se llama al guardar.
 */
export default function FormProyeccion({ proyectos, inicial = {}, proyecciones = [], onGuardado, onCancelar, titulo }) {
  const abiertos = mesesAbiertos()
  const [form, setForm] = useState(() => ({
    project_id: inicial.project_id || (proyectos.length === 1 ? proyectos[0].id : ''),
    mes: abiertos.includes(inicial.mes) ? inicial.mes : abiertos[0],
    concept_id: inicial.concept_id || '', area: inicial.area || 'Consultoría', descripcion: inicial.descripcion || '',
    monto: inicial.monto ?? '', tbd: !!inicial.tbd, id: inicial.id,
  }))
  const [guardando, setGuardando] = useState(false)
  const project = proyectos.find(p => p.id === form.project_id)
  const moneda = project?.currency || 'MXN'
  const datos = useMemo(() => project && prepararProyecto(project), [project])
  const pendientes = useMemo(() => (datos ? conceptosPorEstimar(project, datos.disciplines, datos.estimations) : []), [datos])
  const yaProyectados = new Set(proyecciones.filter(f => f.project_id === form.project_id && f.mes === form.mes && f.id !== form.id).map(f => f.concept_id).filter(Boolean))
  const fijo = !!inicial.project_id || proyectos.length === 1

  function elegirConcepto(cid) {
    const x = pendientes.find(p => p.concept.id === cid)
    setForm(f => ({ ...f, concept_id: cid, area: x ? x.area : f.area, descripcion: x ? `${x.concept.key} ${x.concept.description}`.trim() : f.descripcion, monto: x ? Math.round(x.porEstimar * 100) / 100 : f.monto }))
  }

  async function guardar() {
    if (!form.project_id) { toast('Elige el proyecto', true); return }
    if (!form.tbd && !(+form.monto > 0)) { toast('Escribe el monto (o marca "Por definir")', true); return }
    if (!form.concept_id && !form.descripcion.trim()) { toast('Elige un concepto o escribe qué se va a cobrar', true); return }
    setGuardando(true)
    const fila = { project_id: form.project_id, mes: form.mes, area: form.area, concept_id: form.concept_id || null, descripcion: form.descripcion.trim(), monto: +form.monto || 0, tbd: !!form.tbd, updated_at: new Date().toISOString() }
    const { error } = form.id
      ? await supabase.from('proyecciones').update(fila).eq('id', form.id)
      : await supabase.from('proyecciones').insert(fila)
    setGuardando(false)
    if (error) {
      toast(/proyecciones_concepto_mes/.test(error.message) ? 'Ese concepto ya está proyectado en ese mes'
        : /congeladas/.test(error.message) ? error.message
        : /row-level security|permission/i.test(error.message) ? 'No estás en el equipo de este proyecto: pide al líder que te agregue' : 'No se pudo guardar: ' + error.message, true)
      return
    }
    toast('Proyección guardada ✓')
    onGuardado?.()
  }

  return (
    <div className="card mb-md form-proy" style={{ borderLeft: '4px solid var(--green)' }}>
      <div className="section-header"><span className="section-title">{titulo || (form.id ? 'Cambiar proyección' : 'Nueva proyección')}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Proyecto</label>
          {fijo ? <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 13, padding: '6px 0' }}>{project?.name}</div> : (
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value, concept_id: '', descripcion: '', monto: '' }))} autoFocus>
              <option value="">— Elige el proyecto —</option>
              {[...proyectos].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label>Mes de la estimación</label>
          <select value={form.mes} onChange={e => setForm(f => ({ ...f, mes: e.target.value }))}>
            {abiertos.map(m => <option key={m} value={m}>{textoMes(m)}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Se factura en {textoMes(mesFactura(form.mes))} · se congela el {textoCongelamiento(form.mes)}</div>
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>Concepto por cobrar</label>
          <select value={form.concept_id} disabled={!project} onChange={e => e.target.value ? elegirConcepto(e.target.value) : setForm(f => ({ ...f, concept_id: '' }))}>
            <option value="">— Otro (sin concepto: escribe la descripción) —</option>
            {(datos?.disciplines || []).map(d => {
              const ps = pendientes.filter(p => p.discipline.id === d.id && (!yaProyectados.has(p.concept.id) || p.concept.id === form.concept_id))
              if (!ps.length) return null
              return (
                <optgroup key={d.id} label={d.name}>
                  {ps.map(p => <option key={p.concept.id} value={p.concept.id}>{p.concept.key} · {(p.concept.description || '').slice(0, 70)} — {fmtMoney(p.porEstimar, moneda)}</option>)}
                </optgroup>
              )
            })}
          </select>
          {form.concept_id && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Se sugiere en la estimación de {textoMes(form.mes)} (un clic para marcarlo).</div>}
        </div>
        <div className="field">
          <label>Área</label>
          <select value={form.area} disabled={!!form.concept_id} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}>
            {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {!form.concept_id && (
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Descripción</label>
            <input value={form.descripcion} placeholder="Ej. Hito 2: pruebas funcionales" onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
        )}
        <div className="field">
          <label>Monto{project ? ` (${moneda})` : ''}</label>
          <input type="number" min="0" step="0.01" value={form.monto} disabled={form.tbd} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={form.tbd} onChange={e => setForm(f => ({ ...f, tbd: e.target.checked, monto: e.target.checked ? '' : f.monto }))} /> Por definir (sin monto todavía)
          </label>
        </div>
      </div>
      <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={onCancelar}>Cancelar</button>
        <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  )
}
