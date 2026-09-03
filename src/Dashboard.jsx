import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fmtMoney, fmtPct, fmtDate } from '../utils/format'
import { projectTotals, projectAdvancePct } from '../utils/calculations'
import { toast } from '../components/Toast'

export default function Dashboard() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [projects, setProjects]   = useState([])
  const [aditivas, setAditivas]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatusFilter] = useState('Activo')

  const isCoord = profile?.role === 'coordinador'

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [projRes, aditRes] = await Promise.all([
      supabase.from('projects').select(`
        *,
        disciplines (*, concepts(*)),
        estimations (*, estimation_items(*))
      `).order('created_at', { ascending: false }),
      supabase.from('aditivas').select('project_id, status'),
    ])
    if (projRes.error) { toast('Error al cargar', true); setLoading(false); return }
    setProjects(projRes.data || [])
    setAditivas(aditRes.data || [])
    setLoading(false)
  }

  if (loading) return <div className="main"><div className="spinner" /></div>

  // ── Filtrado por estado ───────────────────────────────────────────────────
  const filtered = statusFilter === 'Todos'
    ? projects
    : projects.filter(p => p.status === statusFilter)

  // ── KPIs globales ─────────────────────────────────────────────────────────
  const activeProjects = projects.filter(p => p.status === 'Activo')

  let totalMonto = 0, totalAcumulado = 0
  activeProjects.forEach(p => {
    const t = projectTotals(p.disciplines || [])
    const adv = projectAdvancePct(p.disciplines || [], p.estimations || [])
    totalMonto     += t.estimable
    totalAcumulado += t.estimable * adv / 100
  })

  const aditivasPendientes = aditivas.filter(a =>
    ['Enviada', 'Negociacion'].includes(a.status)
  ).length

  // Currency más común (para KPIs globales)
  const mxnProjects = activeProjects.filter(p => p.currency === 'MXN')
  const kpiCurrency = mxnProjects.length >= activeProjects.length / 2 ? 'MXN' : 'USD'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="main">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {isCoord ? 'Dashboard ' : 'Mi '}
            <span className="accent">{isCoord ? 'Global' : 'Dashboard'}</span>
          </h1>
          <div className="page-subtitle">
            {isCoord
              ? `Resumen de todos los proyectos · ${projects.length} en total`
              : `Resumen de tus proyectos · ${projects.length} asignados`}
          </div>
        </div>
        <button className="btn btn-outline" onClick={() => navigate('/')}>← Mis Proyectos</button>
      </div>

      {/* KPIs */}
      <div className="summary-grid" style={{ marginBottom: 28 }}>
        <div className="stat-box">
          <div className="stat-label">Proyectos Activos</div>
          <div className="stat-value">{activeProjects.length}</div>
          <div className="stat-sub">{projects.length} en total</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Monto Estimable Total</div>
          <div className="stat-value">{fmtMoney(totalMonto, kpiCurrency)}</div>
          <div className="stat-sub">proyectos activos · {kpiCurrency}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Total Acumulado Facturado</div>
          <div className="stat-value green">{fmtMoney(totalAcumulado, kpiCurrency)}</div>
          <div className="stat-sub">
            {totalMonto > 0 ? fmtPct((totalAcumulado / totalMonto) * 100) : '0%'} del estimable
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Aditivas Pendientes</div>
          <div className="stat-value" style={{ color: aditivasPendientes > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
            {aditivasPendientes}
          </div>
          <div className="stat-sub">Enviadas o en negociación</div>
        </div>
      </div>

      {/* Filtro estado */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['Activo', 'Pausado', 'Cancelado', 'Todos'].map(s => (
          <button key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setStatusFilter(s)}>
            {s} {s !== 'Todos' && `(${projects.filter(p => p.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Tabla de proyectos */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <h3>Sin proyectos {statusFilter !== 'Todos' ? `con estado "${statusFilter}"` : ''}</h3>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th style={{ width: 90 }}>Estado</th>
                <th style={{ width: 160 }}>Avance</th>
                <th className="num" style={{ width: 130 }}>Estimable</th>
                <th className="num" style={{ width: 130 }}>Acumulado</th>
                <th className="num" style={{ width: 130 }}>Por Facturar</th>
                <th style={{ width: 130 }}>Última Est.</th>
                <th style={{ width: 80, textAlign: 'center' }}>Aditivas</th>
                <th style={{ width: 160 }} className="no-print">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const totals  = projectTotals(p.disciplines || [])
                const advance = projectAdvancePct(p.disciplines || [], p.estimations || [])
                const acum    = totals.estimable * advance / 100
                const porFact = Math.max(0, totals.estimable - acum)

                // Última estimación enviada
                const enviadas = (p.estimations || []).filter(e => e.status === 'Enviada')
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                const lastEst = enviadas[0]

                // Aditivas de este proyecto
                const projAds = aditivas.filter(a => a.project_id === p.id)
                const adPend  = projAds.filter(a => ['Enviada','Negociacion'].includes(a.status)).length
                const adAcep  = projAds.filter(a => a.status === 'Aceptada').length

                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}/setup`)}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {p.client} {p.location ? `· ${p.location}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`state-badge state-${p.status}`}>{p.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress" style={{ flex: 1 }}>
                          <div className="progress-bar" style={{ width: `${Math.min(100, advance)}%` }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', minWidth: 36 }}>
                          {fmtPct(advance)}
                        </span>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(totals.estimable, p.currency)}</td>
                    <td className="num" style={{ color: acum > 0 ? 'var(--green-dark)' : 'var(--text-muted)', fontWeight: acum > 0 ? 700 : 400 }}>
                      {fmtMoney(acum, p.currency)}
                    </td>
                    <td className="num muted">{fmtMoney(porFact, p.currency)}</td>
                    <td style={{ fontSize: 12 }}>
                      {lastEst
                        ? <>
                            <div style={{ fontWeight: 600 }}>#{String(lastEst.number).padStart(3,'0')}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                              {fmtDate((lastEst.created_at || '').slice(0,10))}
                            </div>
                          </>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {projAds.length === 0
                        ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                        : <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                            {adPend > 0 && <div style={{ color: 'var(--warning)', fontWeight: 700 }}>{adPend} pendiente{adPend > 1 ? 's' : ''}</div>}
                            {adAcep > 0 && <div style={{ color: 'var(--green-dark)', fontWeight: 700 }}>{adAcep} aceptada{adAcep > 1 ? 's' : ''}</div>}
                            {adPend === 0 && adAcep === 0 && <span style={{ color: 'var(--text-muted)' }}>{projAds.length} total</span>}
                          </div>}
                    </td>
                    <td className="no-print" onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-xs"
                          onClick={() => navigate(`/projects/${p.id}/estimations/current`)}>
                          📋 Est.
                        </button>
                        <button className="btn btn-outline btn-xs"
                          onClick={() => navigate(`/projects/${p.id}/history`)}>
                          Historial
                        </button>
                        <button className="btn btn-outline btn-xs"
                          onClick={() => navigate(`/projects/${p.id}/aditivas`)}>
                          Aditivas
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
