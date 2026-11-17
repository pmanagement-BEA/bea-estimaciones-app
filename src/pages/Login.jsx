import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

// Si Google rechaza o la base no acepta el correo (no está en el directorio), Supabase regresa el error en la URL
function errorDeUrl() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''))
  const d = p.get('error_description')
  if (!d) return ''
  if (/database error/i.test(d)) return 'Tu correo no está dado de alta en el Directorio BEA. Pídele a tu coordinador que te agregue.'
  return d.replace(/\+/g, ' ')
}

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(errorDeUrl)
  const [loading, setLoading] = useState(false)
  const [aviso, setAviso] = useState('')
  const [google, setGoogle] = useState(false)

  // El botón de Google aparece solo cuando el proveedor está activado en Supabase
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then(r => r.ok ? r.json() : null)
      .then(s => setGoogle(!!s?.external?.google))
      .catch(() => {})
  }, [])

  async function entrarConGoogle() {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        queryParams: { hd: 'bioconstruccion.com.mx', prompt: 'select_account' },
      },
    })
    if (error) setError(error.message)
  }

  function olvide() {
    setError('')
    setAviso('Pídele a tu coordinador de área (o al PMO) una contraseña temporal. La asignan en Directorio y al entrar con ella creas la tuya.')
  }

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
          {google && (
            <>
              <button type="button" className="btn btn-outline" onClick={entrarConGoogle}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, color: '#4285F4' }}>G</span> Entrar con Google (correo BEA)
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border, #E2E8F0)' }} /> o con contraseña
                <div style={{ flex: 1, height: 1, background: 'var(--border, #E2E8F0)' }} />
              </div>
            </>
          )}
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
            {aviso && (
              <div style={{ fontSize: 13, color: 'var(--green-dark)', background: 'var(--green-soft)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>
                {aviso}
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
            <button type="button" onClick={olvide} style={{ background: 'none', border: 'none', color: 'var(--text-soft)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              ¿Olvidaste tu contraseña o es tu primera vez?
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
