import { useNavigate } from 'react-router-dom'

export default function TopBar({ profile, onSignOut }) {
  const navigate = useNavigate()
  return (
    <div className="topbar">
      <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <span className="brand-mark">BEA</span>
        <span className="brand-sub">Estimaciones de Proyectos</span>
      </div>
      <div className="topbar-actions">
        {profile && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
            {profile.nombre || profile.email}
            {' · '}
            <span style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: 1 }}>
              {profile.role}
            </span>
          </span>
        )}
        <button className="btn-ghost" style={{ color: 'rgba(255,255,255,.7)', fontSize: 12 }} onClick={onSignOut}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
