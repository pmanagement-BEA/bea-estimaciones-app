import { useNavigate } from 'react-router-dom'

/** Sección que todavía no está lista (Checador, Track). */
export default function EnConstruccion({ titulo, descripcion }) {
  const navigate = useNavigate()
  return (
    <div className="main">
      <div className="breadcrumb">
        <a onClick={() => navigate('/')}>Mis Proyectos</a><span className="sep">›</span><span className="current">{titulo}</span>
      </div>
      <div className="card en-construccion">
        <div className="icono" aria-hidden="true">🚧</div>
        <h1 className="page-title" style={{ marginBottom: 6 }}>{titulo}</h1>
        <div className="etiqueta">En construcción</div>
        <p>{descripcion || 'Estamos trabajando en esta sección. Muy pronto estará disponible.'}</p>
        <button className="btn btn-outline" onClick={() => navigate('/')}>Volver a Proyectos</button>
      </div>
    </div>
  )
}
