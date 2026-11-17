import { useState } from 'react'
import { supabase, contrasenaLista } from '../lib/supabase'

// Se muestra al entrar desde el correo de invitación o de recuperación.
export default function CrearContrasena({ tipo, email, onListo }) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    setError('')
    if (pass.length < 8) return setError('Usa al menos 8 caracteres.')
    if (pass !== pass2) return setError('Las contraseñas no coinciden.')
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: pass })
    setLoading(false)
    if (error) return setError(error.message)
    contrasenaLista()
    onListo()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
          {tipo === 'recovery' ? 'Nueva contraseña' : 'Bienvenido a BEA Estimaciones'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 18 }}>
          {tipo === 'recovery' ? 'Escribe tu nueva contraseña' : 'Crea tu contraseña para entrar'}{email ? <> como <strong>{email}</strong></> : null}.
        </div>
        <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" required autoFocus />
          </div>
          <div className="field">
            <label>Confirmar contraseña</label>
            <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" required />
          </div>
          {error && <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Guardando...' : 'Guardar y entrar'}</button>
        </form>
      </div>
    </div>
  )
}
