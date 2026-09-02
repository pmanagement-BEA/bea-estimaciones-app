import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import Modal from '../components/Modal'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { projectTotals, getAcumuladoAnteriorMap, conceptAmount } from '../utils/calculations'

export default function History() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject]         = useState(null)
  const [disciplines, setDisciplines] = useState([])
  const [estimations, setEstimations] = useState([])
  const [loading, setLoading]         = useState(true)
  const [activeTab, setActiveTab]     = useState('estimaciones')
  const [modal, setModal]             = useState(null)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [projRes, discRes, estRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('disciplines').select('*, concepts(*)').eq('project_id', id).order('sort_order'),
      supabase.from('estimations').select('*, estimation_items(*)').eq('project_id', id).order('created_at'),
    ])
    if (projRes.error) { toast('Error al cargar', true); setLoading(false); return }
    const discs = (discRes.data || []).map(d => ({
      ...d, concepts: [...(d.concepts || [])].sort((a, b) => a.sort_order - b.sort_order),
    }))
    setProject(projRes.data)
    setDisciplines(discs)
    setEstimations(estRes.data || [])
    setLoading(false)
  }

  async function revertToBorrador(estId) {
    const { error } = await supabase.from('estimations').update({ status: 'Borrador' }).eq('id', estId)
    if (error) { toast('Error al revertir', true); return }
    setEstimations(prev => prev.map(e => e.id === estId ? { ...e, status: 'Borrador' } : e))
    toast('Estimación revertida a Borrador ✓')
  }

  async function deleteEstimation(estId) {
    const { error } = await supabase.from('estimations').delete().eq('id', estId)
    if (error) { toast('Error al eliminar', true); return }
    setEstimations(prev => prev.filter(e => e.id !== estId))
    toast('Estimación eliminada')
  }

  if (loading) return <div className="main"><div className="spinner" /></div>
  if (!project) return <div className="main"><div className="empty-state"><h3>No encontrado</h3></div></div>

  const totals = projectTotals(disciplines)
  const enviadas = estimations.filter(e => e.status === 'Enviada')
  const borradores = estimations.filter(e => e.status === 'Borrador')

  // Acumulado global (solo estimaciones Enviadas)
  let acumGlobal = 0
  enviadas.forEach(est => {
    ;(est.estimation_items || []).forEach(item => {
      if (!item.included) return
      for (const d of disciplines) {
        const c = (d.concepts || []).find(c => c.id === item.concept_id)
        if (c) {
          acumGlobal += item.parcial_enabled
            ? ((parseFloat(item.pct_parcial) || 0) / 100) * conceptAmount(c, d)
            : conceptAmount(c, d)
          break
        }
      }
    })
  })
  const avanceGlobal = totals.estimable > 0 ? (acumGlobal / totals.estimable) * 100 : 0

  return (
    <div className="main">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a>
        <span className="sep">›</span>
        <a onClick={() => navigate(`/projects/${id}/setup`)}>{project.name}</a>
        <span className="sep">›</span>
        <span className="current">Historial</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Historial <span className="accent">de Estimaciones</span></h1>
          <div className="page-subtitle">{project.name} · {project.client}</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/projects/${id}/estimations/current`)}>
            + Nueva / Borrador actual
          </button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/setup`)}>⚙ Configuración</button>
          <button className="btn btn-outline" onClick={() => navigate(`/projects/${id}/aditivas`)}>📋 Aditivas</button>
        </div>
      </div>

      {/* Resumen del proyecto */}
      <div className="summary-grid" style={{ marginBottom: 24 }}>
        <div className="stat-box">
          <div className="stat-label">Total Estimaciones</div>
          <div className="stat-value">{estimations.length}</div>
          <div className="stat-sub">{enviadas.length} enviadas · {borradores.length} borradores</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Acumulado Global</div>
          <div className="stat-value green">{fmtMoney(acumGlobal, project.currency)}</div>
          <div className="stat-sub">de {fmtMoney(totals.estimable, project.currency)} estimable</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Avance Global</div>
          <div className="stat-value">{fmtPct(avanceGlobal)}</div>
          <div style={{ marginTop: 6 }}><div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, avanceGlobal)}%` }} /></div></div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Por Estimar</div>
          <div className="stat-value muted">{fmtMoney(Math.max(0, totals.estimable - acumGlobal), project.currency)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs no-print">
        <div className={`tab${activeTab === 'estimaciones' ? ' active' : ''}`} onClick={() => setActiveTab('estimaciones')}>
          Estimaciones ({estimations.length})
        </div>
        <div className={`tab${activeTab === 'detalle' ? ' active' : ''}`} onClick={() => setActiveTab('detalle')}>
          Detalle por Concepto
        </div>
      </div>

      {/* ── TAB: LISTA DE ESTIMACIONES ─────────────── */}
      {activeTab === 'estimaciones' && (
        <div>
          {estimations.length === 0 ? (
            <div className="empty-state">
              <h3>Sin estimaciones</h3>
              <p>Aún no se han creado estimaciones para este proyecto.</p>
              <button className="btn btn-primary" onClick={() => navigate(`/projects/${id}/estimations/current`)}>
                Crear primera estimación
              </button>
            </div>
          ) : (
            <div>
              {/* Borradores primero */}
              {borradores.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>En borrador</div>
                  {borradores.map(est => (
                    <EstimationRow key={est.id} est={est} disciplines={disciplines} estimations={estimations}
                      project={project} navigate={navigate} id={id} setModal={setModal}
                      onDelete={() => setModal({ title: 'Eliminar estimación', body: `<p>¿Eliminar la estimación <strong>#${String(est.number).padStart(3, '0')}</strong>?</p><p style="color:var(--danger);margin-top:8px;font-size:12px">Esta acción no se puede deshacer.</p>`, onConfirm: () => deleteEstimation(est.id) })}
                    />
                  ))}
                </div>
              )}
              {/* Enviadas */}
              {enviadas.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Enviadas</div>
                  {[...enviadas].reverse().map(est => (
                    <EstimationRow key={est.id} est={est} disciplines={disciplines} estimations={estimations}
                      project={project} navigate={navigate} id={id} setModal={setModal}
                      onRevert={() => setModal({ title: 'Revertir a Borrador', body: `<p>¿Revertir la estimación <strong>#${String(est.number).padStart(3, '0')}</strong> a Borrador?</p><p style="color:var(--warning);margin-top:8px;font-size:12px">Podrá volver a editarse. Los cálculos de acumulados se recalcularán.</p>`, onConfirm: () => revertToBorrador(est.id) })}
                      onDelete={() => setModal({ title: 'Eliminar estimación', body: `<p>¿Eliminar la estimación <strong>#${String(est.number).padStart(3, '0')}</strong>?</p><p style="color:var(--danger);margin-top:8px;font-size:12px">Esta acción no se puede deshacer.</p>`, onConfirm: () => deleteEstimation(est.id) })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: DETALLE POR CONCEPTO ────────────── */}
      {activeTab === 'detalle' && (
        <div>
          {disciplines.length === 0 ? (
            <div className="empty-state"><h3>Sin disciplinas configuradas</h3></div>
          ) : disciplines.map(d => {
            const enviadasAcum = getAcumuladoAnteriorMap(disciplines, estimations, null)
            return (
              <div key={d.id} className="discipline-block" style={{ marginBottom: 14 }}>
                <div className="discipline-header">
                  <div className="discipline-name">{d.name}</div>
                </div>
                <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Clave</th>
                        <th>Descripción</th>
                        <th className="num" style={{ width: 120 }}>Monto Total</th>
                        <th className="num" style={{ width: 120 }}>Acumulado</th>
                        <th className="num" style={{ width: 120 }}>Por Estimar</th>
                        <th style={{ width: 140 }}>Progreso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.concepts || []).length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin conceptos</td></tr>
                      ) : (d.concepts || []).map(c => {
                        const monto = conceptAmount(c, d)
                        const acum = enviadasAcum[c.id] || 0
                        const porEst = Math.max(0, monto - acum)
                        const pct = monto > 0 ? (acum / monto) * 100 : 0
                        return (
                          <tr key={c.id} className={`concept-row${c.type === 'Finiquito' ? ' finiquito' : ''}`}>
                            <td><strong>{c.key}</strong></td>
                            <td>{c.description}</td>
                            <td className="num">{fmtMoney(monto, project.currency)}</td>
                            <td className="num" style={{ color: acum > 0 ? 'var(--green-dark)' : 'var(--text-muted)', fontWeight: acum > 0 ? 700 : 400 }}>{fmtMoney(acum, project.currency)}</td>
                            <td className="num muted">{fmtMoney(porEst, project.currency)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="progress" style={{ flex: 1 }}><div className="progress-bar" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 36, textAlign: 'right' }}>{fmtPct(pct)}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && <Modal title={modal.title} body={modal.body} confirmText="Confirmar" onConfirm={modal.onConfirm} onClose={() => setModal(null)} />}
    </div>
  )
}

// ── Sub-componente: fila de estimación ────────────────────────────────────────
function EstimationRow({ est, disciplines, estimations, project, navigate, id, setModal, onRevert, onDelete }) {
  const acumMap = getAcumuladoAnteriorMap(disciplines, estimations, est.id)

  let thisTotal = 0
  ;(est.estimation_items || []).forEach(item => {
    if (!item.included) return
    for (const d of disciplines) {
      const c = (d.concepts || []).find(c => c.id === item.concept_id)
      if (c) {
        thisTotal += item.parcial_enabled
          ? ((parseFloat(item.pct_parcial) || 0) / 100) * conceptAmount(c, d)
          : conceptAmount(c, d)
        break
      }
    }
  })

  let acumAnterior = 0
  Object.values(acumMap).forEach(v => { acumAnterior += v })

  const totals = projectTotals(disciplines)
  const advancePct = totals.estimable > 0 ? ((acumAnterior + thisTotal) / totals.estimable) * 100 : 0
  const numLabel = `#${String(est.number).padStart(3, '0')}`
  const isBorrador = est.status === 'Borrador'

  return (
    <div className="history-item" style={{ flexWrap: 'wrap', gap: 10 }}>
      {/* Num + estado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
        <span className="history-num">{numLabel}</span>
        <span className={`history-status ${est.status}`}>{est.status}</span>
      </div>
      {/* Periodo */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>
          {est.period_from ? `${fmtDate(est.period_from)} — ${fmtDate(est.period_to)}` : 'Período no definido'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {(est.estimation_items || []).filter(i => i.included).length} conceptos incluidos
        </div>
      </div>
      {/* Monto */}
      <div style={{ textAlign: 'right', minWidth: 140 }}>
        <div className="history-amount">{fmtMoney(thisTotal, project.currency)}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Acum: {fmtPct(advancePct)}
        </div>
      </div>
      {/* Acciones */}
      <div className="flex" style={{ gap: 6 }}>
        <button className="btn btn-outline btn-sm" onClick={() => navigate(`/projects/${id}/estimations/${est.id}`)}>
          {isBorrador ? '✏ Editar' : '👁 Ver'}
        </button>
        {!isBorrador && onRevert && (
          <button className="btn btn-outline btn-sm" onClick={onRevert} title="Revertir a Borrador">↩ Revertir</button>
        )}
        <button className="btn btn-danger btn-sm" onClick={onDelete} title="Eliminar">✕</button>
      </div>
    </div>
  )
}
