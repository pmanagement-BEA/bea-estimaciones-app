import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { projectTotals, projectAdvancePct, projectRates, projectPhase } from '../utils/calculations'
import { toast } from '../components/Toast'
import { fetchMyAssignments, TEAM_ROLE_LABEL } from '../lib/directorio'

// TODO: migrar renderProjects() del HTML a esta página
export default function Projects() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState({}) // { project_id: [rol] }
  const [onlyMine, setOnlyMine] = useState(true)
  const [verInactivos, setVerInactivos] = useState(false)
  // Solo lectura (p. ej. Facturación) no está asignado a proyectos: de inicio ve todos
  useEffect(() => { if (profile?.role === 'lectura') setOnlyMine(false) }, [profile?.role])
  const canCreate = !profile || ['lider', 'coordinador'].includes(profile.role)

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => {
    if (profile?.email) fetchMyAssignments(profile.email).then(setMine)
  }, [profile?.email])

  async function fetchProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        disciplines (
          *,
          concepts (*)
        ),
        estimations (
          *,
          estimation_items (*)
        )
      `)
      .order('created_at', { ascending: false })

    if (error) { toast('Error al cargar proyectos', true); setLoading(false); return }
    setProjects(data || [])
    setLoading(false)
  }

  async function createProject() {
    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: (await supabase.auth.getUser()).data.user.id })
      .select()
      .single()
    if (error) { toast('Error al crear proyecto', true); return }
    navigate(`/projects/${data.id}/setup`)
  }

  if (loading) return <div className="main"><div className="spinner" /></div>

  return (
    <div className="main">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis <span className="accent">Proyectos</span></h1>
          <div className="page-subtitle">Herramienta de estimación mensual · BEA</div>
        </div>
        <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
          {(
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} />
              Solo donde estoy asignado
            </label>
          )}
          {projects.some(p => p.status === 'Inactivo') && (
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} />
              Ver inactivos ({projects.filter(p => p.status === 'Inactivo').length})
            </label>
          )}
          {canCreate && <button className="btn btn-primary" onClick={createProject}>+ Nuevo Proyecto</button>}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No hay proyectos todavía</h3>
          <p>{canCreate ? 'Comienza creando tu primer proyecto.' : 'Cuando un líder te asigne a un proyecto, aparecerá aquí.'}</p>
          {canCreate && <button className="btn btn-primary" onClick={createProject}>+ Nuevo Proyecto</button>}
        </div>
      ) : (
        <div className="project-grid">
          {projects
            .filter(p => !onlyMine || mine[p.id] || p.user_id === profile?.id)
            .filter(p => verInactivos || p.status !== 'Inactivo')
            .map(p => {
            const totals = projectTotals(p.disciplines || [], projectRates(p))
            const advance = projectAdvancePct(p.disciplines || [], p.estimations || [], projectRates(p))
            const statusClass = p.status === 'Pausado' ? 'paused' : ['Cancelado', 'Terminado', 'Inactivo'].includes(p.status) ? 'cancelled' : ''
            return (
              <div key={p.id} className={`project-card ${statusClass}`} onClick={() => navigate(`/projects/${p.id}/setup`)}>
                <span className={`state-badge state-${p.status}`}>{p.status}</span>
                <h3>{p.name}</h3>
                {p.origen_datos === 'sin_estimaciones' && !(p.estimations || []).some(e => e.status === 'Enviada') && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)', margin: '2px 0 4px' }}>
                    ⚠ Sin estimaciones encontradas · carga manual al activarse
                  </div>
                )}
                {(mine[p.id] || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '2px 0 4px' }}>
                    {mine[p.id].map(r => (
                      <span key={r} style={{ fontSize: 10, fontWeight: 600, background: 'var(--green-soft)', color: 'var(--green-dark)', padding: '2px 8px', borderRadius: 99 }}>
                        Tú: {TEAM_ROLE_LABEL[r] || r}
                      </span>
                    ))}
                  </div>
                )}
                <div className="project-meta">{[p.client, p.location].filter(Boolean).join(' · ') || '—'}</div>
                <div className="project-meta">
                  {p.service_type}
                  {(() => { const f = projectPhase(p.disciplines || [], p.estimations || [], projectRates(p)); return f ? ` · Fase: ${f}` : '' })()}
                </div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>Avance global</span>
                    <strong style={{ color: 'var(--navy)' }}>{fmtPct(advance)}</strong>
                  </div>
                  <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, advance)}%` }} /></div>
                </div>
                <div className="project-stats">
                  <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', fontWeight: 600 }}>Importe Total</div>
                    <div className="project-amount">
                      {fmtMoney(totals.conDescuento, p.currency)}
                      <span className="project-currency">{p.currency}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); navigate(`/projects/${p.id}/estimations/current`) }}>
                      📋 Estimación
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); navigate(`/projects/${p.id}/history`) }}>
                      Historial
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
