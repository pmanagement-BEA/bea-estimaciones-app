import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { projectTotals, projectAdvancePct } from '../utils/calculations'
import { toast } from '../components/Toast'

// TODO: migrar renderProjects() del HTML a esta página
export default function Projects() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchProjects() }, [])

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
        <button className="btn btn-primary" onClick={createProject}>+ Nuevo Proyecto</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No hay proyectos todavía</h3>
          <p>Comienza creando tu primer proyecto.</p>
          <button className="btn btn-primary" onClick={createProject}>+ Nuevo Proyecto</button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map(p => {
            const totals = projectTotals(p.disciplines || [])
            const advance = projectAdvancePct(p.disciplines || [], p.estimations || [])
            const statusClass = p.status === 'Pausado' ? 'paused' : p.status === 'Cancelado' ? 'cancelled' : ''
            return (
              <div key={p.id} className={`project-card ${statusClass}`} onClick={() => navigate(`/projects/${p.id}/setup`)}>
                <span className={`state-badge state-${p.status}`}>{p.status}</span>
                <h3>{p.name}</h3>
                <div className="project-meta">{p.client} · {p.location || '—'}</div>
                <div className="project-meta">{p.service_type} · Fase: {p.phase}</div>
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
                      {fmtMoney(totals.importeTotal, p.currency)}
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
