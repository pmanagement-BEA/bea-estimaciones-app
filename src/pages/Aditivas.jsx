import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtDate } from '../utils/format'

const STATUS_STYLE = {
  Borrador:    { bg: 'var(--surface-2)',  color: 'var(--text-soft)',  border: 'var(--border-strong)' },
  Enviada:     { bg: '#EFF6FF',           color: '#1D4ED8',           border: '#93C5FD' },
  Aceptada:    { bg: 'var(--green-soft)', color: 'var(--green-dark)', border: '#86EFAC' },
  Negada:      { bg: 'var(--danger-soft)',color: 'var(--danger)',      border: '#FCA5A5' },
  Negociacion: { bg: '#FEF3C7',           color: '#B7791F',           border: '#FCD34D' },
}
const ALL_STATUSES = ['Borrador', 'Enviada', 'Aceptada', 'Negada', 'Negociacion']

export default function Aditivas() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject]   = useState(null)
  const [aditivas, setAditivas] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [dateModal, setDateModal] = useState(null) // { aditivaId, newStatus, oldStatus }
  const [decisionDate, setDecisionDate] = useState('')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [projRes, aditRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('aditivas').select('*, aditiva_alcances(*)').eq('project_id', id).order('created_at'),
    ])
    if (projRes.error) { toast('Error al cargar', true); setLoading(false); return }
    setProject(projRes.data)
    setAditivas((aditRes.data || []).map(a => ({ ...a, aditiva_alcances: [...(a.aditiva_alcances || [])].sort((x, y) => x.sort_order - y.sort_order) })))
    setLoading(false)
  }

  async function deleteAditiva(adId) {
    const { error } = await supabase.from('aditivas').delete().eq('id', adId)
    if (error) { toast('Error al eliminar', true); return }
    setAditivas(prev => prev.filter(a => a.id !== adId))
    toast('Aditiva eliminada')
  }

  async function changeStatus(aditivaId, newStatus) {
    const aditiva = aditivas.find(a => a.id === aditivaId)
    if (!aditiva || aditiva.status === newStatus) return
    const oldStatus = aditiva.status

    if (newStatus === 'Aceptada' || newStatus === 'Negada') {
      setDecisionDate(new Date().toISOString().slice(0, 10))
      setDateModal({ aditivaId, newStatus, oldStatus })
      return
    }
    await applyStatusChange(aditivaId, newStatus, oldStatus, new Date().toISOString().slice(0, 10))
  }

  async function applyStatusChange(aditivaId, newStatus, oldStatus, decisionDate) {
    const aditiva = aditivas.find(a => a.id === aditivaId)
    if (!aditiva) return
    const newHistory = [...(aditiva.status_history || []), { status: newStatus, from: oldStatus, date: decisionDate + 'T12:00:00.000Z' }]
    const updates = {
      status: newStatus,
      status_history: newHistory,
      ...(newStatus === 'Aceptada' ? { fecha_aceptada: decisionDate } : {}),
      ...(newStatus === 'Negada'   ? { fecha_rechazada: decisionDate } : {}),
    }
    const { error } = await supabase.from('aditivas').update(updates).eq('id', aditivaId)
    if (error) { toast('Error al cambiar estado', true); return }
    setAditivas(prev => prev.map(a => a.id === aditivaId ? { ...a, ...updates } : a))
    toast(`Aditiva → ${newStatus}`)
  }

  if (loading) return <div className="main"><div className="spinner" /></div>
  if (!project) return <div className="main"><div className="empty-state"><h3>No encontrado</h3></div></div>

  const totalAditivas = aditivas.reduce((s, a) => s + (a.aditiva_alcances || []).reduce((ss, al) => ss + (parseFloat(al.monto) || 0), 0), 0)
  const aceptadas = aditivas.filter(a => a.status === 'Aceptada')
  const totalAceptado = aceptadas.reduce((s, a) => s + (a.aditiva_alcances || []).reduce((ss, al) => ss + (parseFloat(al.monto) || 0), 0), 0)

  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a>
        <span className="sep">›</span>
        <span className="current">Aditivas</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Aditivas <span className="accent">{project.name}</span></h1>
          <div className="page-subtitle">Cobros adicionales por extensión de alcance · {project.client}</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/projects/${id}/aditivas/new`)}>+ Nueva Aditiva</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/setup`)}>⚙ Configuración</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/history`)}>📋 Historial</button>
        </div>
      </div>

      {/* Resumen */}
      <div className="summary-grid" style={{ marginBottom: 24 }}>
        <div className="stat-box">
          <div className="stat-label">Total Aditivas</div>
          <div className="stat-value">{aditivas.length}</div>
          <div className="stat-sub">{aceptadas.length} aceptadas</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Monto Total Solicitado</div>
          <div className="stat-value">{fmtMoney(totalAditivas, project.currency)}</div>
          <div className="stat-sub">+ IVA</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Monto Aceptado</div>
          <div className="stat-value green">{fmtMoney(totalAceptado, project.currency)}</div>
          <div className="stat-sub">+ IVA</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Por Definir</div>
          <div className="stat-value muted">{fmtMoney(totalAditivas - totalAceptado, project.currency)}</div>
          <div className="stat-sub">{aditivas.filter(a => !['Aceptada','Negada'].includes(a.status)).length} pendientes</div>
        </div>
      </div>

      {/* Lista */}
      {aditivas.length === 0 ? (
        <div className="empty-state">
          <h3>Sin aditivas registradas</h3>
          <p>Las aditivas son cobros adicionales al cliente por exceder el alcance o tiempo cotizado.</p>
          <button className="btn btn-primary" onClick={() => navigate(`/projects/${id}/aditivas/new`)}>+ Nueva Aditiva</button>
        </div>
      ) : (
        <div>
          {aditivas.map(a => {
            const sc = STATUS_STYLE[a.status] || STATUS_STYLE.Borrador
            const total = (a.aditiva_alcances || []).reduce((s, al) => s + (parseFloat(al.monto) || 0), 0)
            const hist = a.status_history || []
            const numLabel = `#${String(a.number).padStart(3, '0')}`

            return (
              <div key={a.id} className="history-item" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                {/* Info principal */}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className="history-num">{numLabel} — {a.asunto || 'Sin asunto'}</div>
                  <div className="history-date" style={{ marginTop: 3 }}>
                    Fecha: {fmtDate(a.fecha)} · {a.cliente_atn || a.cliente_nombre || '—'}
                    {a.fecha_aceptada && <span style={{ color: 'var(--green-dark)', fontWeight: 600 }}> · Aceptada: {fmtDate(a.fecha_aceptada)}</span>}
                    {a.fecha_rechazada && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> · Negada: {fmtDate(a.fecha_rechazada)}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>
                    {(a.aditiva_alcances || []).length} alcance(s) · Monto total: <strong>{fmtMoney(total, project.currency)} + IVA</strong>
                  </div>
                  {hist.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        📜 Ver historial de estado ({hist.length})
                      </summary>
                      <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 11 }}>
                        {hist.map((h, i) => (
                          <div key={i} style={{ marginBottom: 2 }}>
                            • <strong>{h.status}</strong> — {fmtDate((h.date || '').slice(0, 10))}
                            {h.from && <span style={{ color: 'var(--text-muted)' }}> (desde {h.from})</span>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Estado + acciones */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <select
                    value={a.status}
                    onChange={e => changeStatus(a.id, e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, border: `1.5px solid ${sc.border}`, background: sc.bg, color: sc.color, cursor: 'pointer' }}>
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex" style={{ gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => navigate(`/projects/${id}/aditivas/${a.id}/edit`)}>✏ Editar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setModal({
                      title: 'Eliminar aditiva',
                      body: `<p>¿Eliminar la aditiva <strong>${numLabel}</strong>?</p><p style="color:var(--danger);margin-top:8px;font-size:12px">Esta acción no se puede deshacer.</p>`,
                      onConfirm: () => deleteAditiva(a.id),
                    })}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal confirmación fecha Aceptada/Negada */}
      {dateModal && (
        <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && setDateModal(null)}>
          <div className="modal">
            <div className="modal-title">{dateModal.newStatus === 'Aceptada' ? '✓ Marcar como Aceptada' : '✕ Marcar como Negada'}</div>
            <div className="modal-body">
              <p>Indica la fecha en que el cliente notificó su {dateModal.newStatus === 'Aceptada' ? 'aceptación' : 'rechazo'}.</p>
              <div className="field" style={{ marginTop: 12 }}>
                <label>Fecha de {dateModal.newStatus === 'Aceptada' ? 'aceptación' : 'rechazo'}</label>
                <input type="date" value={decisionDate} onChange={e => setDecisionDate(e.target.value)}
                  style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, marginTop: 4, width: '100%' }} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setDateModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => {
                applyStatusChange(dateModal.aditivaId, dateModal.newStatus, dateModal.oldStatus, decisionDate)
                setDateModal(null)
              }}>Confirmar {dateModal.newStatus}</button>
            </div>
          </div>
        </div>
      )}

      {modal && <Modal title={modal.title} body={modal.body} confirmText="Eliminar" onConfirm={modal.onConfirm} onClose={() => setModal(null)} />}
    </div>
  )
}
