import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--navy)', letterSpacing: 1 }}>
            BEA
            <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--green)', transform: 'skewX(-15deg)', borderRadius: 2, marginLeft: 4, verticalAlign: 'middle' }} />
          </div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 4 }}>
            Estimaciones de Proyectos
          </div>
        </div>

        <div className="card" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', marginBottom: 20 }}>
            Iniciar sesión
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nombre@bea.mx"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>
                {error}
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          Bioconstrucción y Energía Alternativa · Uso interno
        </div>
      </div>
    </div>
  )
}
