import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtDate } from '../utils/format'

const ALL_STATUSES = ['Borrador', 'Enviada', 'Aceptada', 'Negada', 'Negociacion']

function emptyAlcance() {
  return { id: null, descripcion: '', items: '', entregable: '', monto: 0, sort_order: 0, _isNew: true }
}

export default function AditivaForm() {
  const { id, adId } = useParams()
  const navigate = useNavigate()
  const isNew = !adId || adId === 'new'

  const [project, setProject]     = useState(null)
  const [aditiva, setAditiva]     = useState(null)
  const [alcances, setAlcances]   = useState([emptyAlcance()])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [modal, setModal]         = useState(null)
  const saveTimer = useRef(null)

  useEffect(() => { fetchAll() }, [id, adId])

  async function fetchAll() {
    setLoading(true)
    const projRes = await supabase.from('projects').select('*').eq('id', id).single()
    if (projRes.error) { toast('Error al cargar', true); setLoading(false); return }
    const p = projRes.data
    setProject(p)

    if (isNew) {
      // Contar aditivas existentes para el número
      const { count } = await supabase.from('aditivas').select('*', { count: 'exact', head: true }).eq('project_id', id)
      const today = new Date().toISOString().slice(0, 10)
      setAditiva({
        number: (count || 0) + 1, fecha: today,
        ciudad: 'San Pedro Garza García, N.L.',
        cliente_nombre: p.client || '', cliente_atn: p.client_contact_name || '', cliente_email: p.client_contact_email || '',
        proyecto: p.name || '', asunto: 'Aditiva por cambios en diseño',
        status: 'Borrador', fecha_aceptada: null, fecha_rechazada: null, status_history: [],
        intro: `Aprovechamos este medio para saludarlo de manera cordial, y para notificarle los efectos de nuestros servicios de "Gestión Integral del Proceso de Certificación LEED" para el proyecto de ${p.name || ''}.`,
        clausulas: 'Cláusula 9\n"Actividades adicionales y gastos extraordinarios se pagarán por separado, previa aceptación de cotización por parte del cliente."',
        cierre_texto: 'Agradeceremos su consentimiento a las condiciones anteriormente expuestas, firmando de Vo.Bo. y para autorización a la presente misiva.',
        elaborado_por: p.team?.lider || '', aceptado_por: p.client_contact_name || '', ccps: '',
      })
      setAlcances([{ ...emptyAlcance(), sort_order: 0 }])
    } else {
      const { data, error } = await supabase.from('aditivas').select('*, aditiva_alcances(*)').eq('id', adId).single()
      if (error) { toast('Aditiva no encontrada', true); setLoading(false); return }
      setAditiva(data)
      const sorted = [...(data.aditiva_alcances || [])].sort((a, b) => a.sort_order - b.sort_order)
      setAlcances(sorted.length > 0 ? sorted : [{ ...emptyAlcance(), sort_order: 0 }])
    }
    setLoading(false)
  }

  function setField(field, value) {
    setAditiva(prev => ({ ...prev, [field]: value }))
  }

  // ── Alcances ───────────────────────────────────────────────────────────────
  function addAlcance() {
    setAlcances(prev => [...prev, { ...emptyAlcance(), sort_order: prev.length }])
  }
  function removeAlcance(idx) {
    setAlcances(prev => prev.filter((_, i) => i !== idx).map((a, i) => ({ ...a, sort_order: i })))
  }
  function setAlcanceField(idx, field, value) {
    setAlcances(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a))
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  async function save(markAs) {
    setSaving(true)
    const status = markAs || aditiva.status
    const payload = {
      project_id: id, number: aditiva.number, fecha: aditiva.fecha || null,
      ciudad: aditiva.ciudad || '', cliente_nombre: aditiva.cliente_nombre || '',
      cliente_atn: aditiva.cliente_atn || '', cliente_email: aditiva.cliente_email || '',
      proyecto: aditiva.proyecto || '', asunto: aditiva.asunto || '',
      status, fecha_aceptada: aditiva.fecha_aceptada || null, fecha_rechazada: aditiva.fecha_rechazada || null,
      status_history: aditiva.status_history || [],
      intro: aditiva.intro || '', clausulas: aditiva.clausulas || '',
      cierre_texto: aditiva.cierre_texto || '', elaborado_por: aditiva.elaborado_por || '',
      aceptado_por: aditiva.aceptado_por || '', ccps: aditiva.ccps || '',
    }

    let aditivaId = aditiva.id
    if (isNew || !aditivaId) {
      const { data, error } = await supabase.from('aditivas').insert(payload).select().single()
      if (error) { toast('Error al guardar', true); setSaving(false); return }
      aditivaId = data.id
      setAditiva(prev => ({ ...prev, id: aditivaId, status }))
    } else {
      const { error } = await supabase.from('aditivas').update({ ...payload }).eq('id', aditivaId)
      if (error) { toast('Error al guardar', true); setSaving(false); return }
      setAditiva(prev => ({ ...prev, status }))
    }

    // Guardar alcances
    const alcanceRows = alcances.map((al, i) => ({
      aditiva_id: aditivaId, sort_order: i,
      descripcion: al.descripcion || '', items: al.items || '',
      entregable: al.entregable || '', monto: parseFloat(al.monto) || 0,
    }))

    // Borrar los existentes y re-insertar (más simple que upsert con IDs mixtos)
    await supabase.from('aditiva_alcances').delete().eq('aditiva_id', aditivaId)
    if (alcanceRows.length > 0) {
      const { data: newAlc } = await supabase.from('aditiva_alcances').insert(alcanceRows).select()
      if (newAlc) setAlcances([...newAlc].sort((a, b) => a.sort_order - b.sort_order))
    }

    setSaving(false)
    toast(markAs ? `Aditiva marcada como ${markAs} ✓` : 'Guardado ✓')

    if (isNew) navigate(`/projects/${id}/aditivas/${aditivaId}/edit`, { replace: true })
  }

  if (loading) return <div className="main"><div className="spinner" /></div>
  if (!project || !aditiva) return <div className="main"><div className="empty-state"><h3>No encontrado</h3></div></div>

  const total = alcances.reduce((s, al) => s + (parseFloat(al.monto) || 0), 0)
  const numLabel = `#${String(aditiva.number).padStart(3, '0')}`
  const isEditable = !['Aceptada', 'Negada'].includes(aditiva.status)

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/aditivas`)}>Aditivas</a>
        <span className="sep">›</span>
        <span className="current">{isNew ? 'Nueva' : 'Editar'} Aditiva {numLabel}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{isNew ? 'Nueva' : 'Editar'} <span className="accent">Aditiva {numLabel}</span></h1>
          <div className="page-subtitle">{project.name} · {project.client}</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/aditivas`)}>← Historial</button>
          <button className="btn btn-outline" onClick={() => save()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar borrador'}</button>
          {aditiva.status === 'Borrador' && (
            <button className="btn btn-primary" onClick={() => setModal({
              title: '✉ Marcar como Enviada',
              body: '<p>Al marcar como <strong>Enviada</strong>, la aditiva queda registrada como notificada al cliente.</p>',
              onConfirm: () => save('Enviada'),
            })}>✉ Marcar como Enviada</button>
          )}
          {!['Borrador', 'Enviada'].includes(aditiva.status) && (
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 14px', fontSize: 12, fontWeight: 700, color: aditiva.status === 'Aceptada' ? 'var(--green-dark)' : aditiva.status === 'Negada' ? 'var(--danger)' : '#B7791F' }}>
              {aditiva.status === 'Aceptada' ? '✓ Aceptada' : aditiva.status === 'Negada' ? '✕ Negada' : '🔄 Negociación'}
            </span>
          )}
        </div>
      </div>

      {!isEditable && (
        <div className="readonly-banner" style={{ marginBottom: 16 }}>
          <span>Esta aditiva está <strong>{aditiva.status}</strong>. Para editarla, cámbiala a Borrador desde el listado.</span>
        </div>
      )}

      {/* Datos de la Carta */}
      <div className="card mb-md">
        <div className="section-header"><div className="section-title">Datos de la Carta</div></div>
        <div className="grid grid-3">
          <div className="field">
            <label>Ciudad</label>
            <input value={aditiva.ciudad || ''} disabled={!isEditable} onChange={e => setField('ciudad', e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={aditiva.fecha || ''} disabled={!isEditable} onChange={e => setField('fecha', e.target.value)} />
          </div>
          <div className="field">
            <label>Número de aditiva</label>
            <input value={aditiva.number} disabled />
          </div>
          <div className="field">
            <label>Cliente (empresa)</label>
            <input value={aditiva.cliente_nombre || ''} disabled={!isEditable} onChange={e => setField('cliente_nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Atención (nombre)</label>
            <input value={aditiva.cliente_atn || ''} disabled={!isEditable} onChange={e => setField('cliente_atn', e.target.value)} />
          </div>
          <div className="field">
            <label>Email del cliente</label>
            <input type="email" value={aditiva.cliente_email || ''} disabled={!isEditable} onChange={e => setField('cliente_email', e.target.value)} />
          </div>
          <div className="field">
            <label>Nombre del proyecto</label>
            <input value={aditiva.proyecto || ''} disabled={!isEditable} onChange={e => setField('proyecto', e.target.value)} />
          </div>
          <div className="field">
            <label>Asunto</label>
            <input value={aditiva.asunto || ''} disabled={!isEditable} onChange={e => setField('asunto', e.target.value)} />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={aditiva.status} disabled={!isEditable} onChange={e => setField('status', e.target.value)}>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Cuerpo de la Carta */}
      <div className="card mb-md">
        <div className="section-header"><div className="section-title">Cuerpo de la Carta</div></div>
        <div className="field mb-md">
          <label>Párrafo de introducción / contexto</label>
          <textarea rows={4} value={aditiva.intro || ''} disabled={!isEditable}
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
            onChange={e => setField('intro', e.target.value)} />
        </div>
        <div className="field mb-md">
          <label>Cláusulas aplicables</label>
          <textarea rows={5} value={aditiva.clausulas || ''} disabled={!isEditable}
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
            onChange={e => setField('clausulas', e.target.value)} />
        </div>
        <div className="field">
          <label>Párrafo de cierre / solicitud</label>
          <textarea rows={3} value={aditiva.cierre_texto || ''} disabled={!isEditable}
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
            onChange={e => setField('cierre_texto', e.target.value)} />
        </div>
      </div>

      {/* Alcances y Montos */}
      <div className="card mb-md">
        <div className="section-header">
          <div className="section-title">Alcances y Montos</div>
          {isEditable && <button className="btn btn-outline btn-sm" onClick={addAlcance}>+ Alcance</button>}
        </div>

        {alcances.map((al, idx) => (
          <div key={idx} className="discipline-block" style={{ marginBottom: 10 }}>
            <div className="discipline-header">
              <div className="discipline-name" style={{ flex: 1 }}>Alcance {idx + 1}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(parseFloat(al.monto) || 0, project.currency)} + IVA</span>
                {isEditable && alcances.length > 1 && (
                  <button className="btn btn-danger btn-xs" onClick={() => removeAlcance(idx)}>✕</button>
                )}
              </div>
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Descripción del alcance</label>
                <input value={al.descripcion || ''} disabled={!isEditable}
                  placeholder="Ej: Revisión preliminar y final de créditos de diseño abiertos"
                  onChange={e => setAlcanceField(idx, 'descripcion', e.target.value)} />
              </div>
              <div className="field">
                <label>Conceptos incluidos (uno por línea)</label>
                <textarea rows={4} value={al.items || ''} disabled={!isEditable}
                  placeholder={'LT: Green Vehicles\nSS: Heat Island Reduction\nWE: Indoor Water Use Reduction'}
                  style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
                  onChange={e => setAlcanceField(idx, 'items', e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Entregables asociados</label>
                  <input value={al.entregable || ''} disabled={!isEditable}
                    placeholder="Ej: Checklist LEED actualizado"
                    onChange={e => setAlcanceField(idx, 'entregable', e.target.value)} />
                </div>
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>Monto (sin IVA)</label>
                  <input type="number" min="0" step="0.01" value={al.monto || 0} disabled={!isEditable}
                    style={{ textAlign: 'right', fontWeight: 700 }}
                    onChange={e => setAlcanceField(idx, 'monto', e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Total */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Monto Total</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(total, project.currency)} + IVA</div>
          </div>
        </div>
      </div>

      {/* Firmas */}
      <div className="card mb-md">
        <div className="section-header"><div className="section-title">Firmas y Datos de Cierre</div></div>
        <div className="grid grid-3">
          <div className="field">
            <label>Elaborado por (BEA)</label>
            <input value={aditiva.elaborado_por || ''} disabled={!isEditable} onChange={e => setField('elaborado_por', e.target.value)} />
          </div>
          <div className="field">
            <label>Acepta de conformidad (cliente)</label>
            <input value={aditiva.aceptado_por || ''} disabled={!isEditable} onChange={e => setField('aceptado_por', e.target.value)} />
          </div>
          <div className="field">
            <label>CCp (separar con comas)</label>
            <input value={aditiva.ccps || ''} disabled={!isEditable} onChange={e => setField('ccps', e.target.value)} placeholder="nombre@email.com, nombre2@email.com" />
          </div>
        </div>
      </div>

      {/* Botón guardar inferior */}
      {isEditable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }} className="no-print">
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/aditivas`)}>Cancelar</button>
          <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 24px' }} onClick={() => save()} disabled={saving}>
            {saving ? 'Guardando...' : '✓ Guardar Aditiva'}
          </button>
        </div>
      )}

      {modal && <Modal title={modal.title} body={modal.body} confirmText="Confirmar" onConfirm={modal.onConfirm} onClose={() => setModal(null)} />}
    </div>
  )
}
