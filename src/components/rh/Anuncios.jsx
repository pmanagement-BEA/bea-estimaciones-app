import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../Toast'
import { ZONA } from '../../lib/checador'

const fechaAnuncio = t => new Date(t).toLocaleDateString('es-MX', { timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric' })

/** Cuántos anuncios no ha visto esta persona (para el contador de la pestaña). */
export async function anunciosSinVer(email) {
  const [a, v] = await Promise.all([supabase.from('anuncios').select('id'), supabase.from('anuncios_vistos').select('anuncio_id').eq('email', email)])
  const vistos = new Set((v.data || []).map(x => x.anuncio_id))
  return (a.data || []).filter(x => !vistos.has(x.id)).length
}

function FormAnuncio({ inicial, yo, onListo, onCancelar }) {
  const [f, setF] = useState({ titulo: inicial?.titulo || '', cuerpo: inicial?.cuerpo || '', fijado: !!inicial?.fijado })
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    if (!f.titulo.trim()) { toast('Escribe el título', true); return }
    setGuardando(true)
    const fila = { titulo: f.titulo.trim(), cuerpo: f.cuerpo.trim(), fijado: f.fijado }
    const { error } = inicial
      ? await supabase.from('anuncios').update({ ...fila, editado_en: new Date().toISOString() }).eq('id', inicial.id)
      : await supabase.from('anuncios').insert({ ...fila, autor_email: yo })
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, true); return }
    toast(inicial ? 'Anuncio actualizado ✓' : 'Anuncio publicado ✓'); onListo()
  }
  return (
    <div className="form-anuncio">
      <input placeholder="Título" value={f.titulo} maxLength={120} onChange={e => setF(x => ({ ...x, titulo: e.target.value }))} autoFocus aria-label="Título" />
      <textarea rows={7} placeholder="Mensaje para todo el equipo…" value={f.cuerpo} maxLength={4000} onChange={e => setF(x => ({ ...x, cuerpo: e.target.value }))} aria-label="Mensaje" />
      <div className="pie">
        <label className="chk"><input type="checkbox" checked={f.fijado} onChange={e => setF(x => ({ ...x, fijado: e.target.checked }))} /> 📌 Fijar arriba</label>
        <div className="acciones">
          <button className="btn btn-outline btn-sm" onClick={onCancelar} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Publicar'}</button>
        </div>
      </div>
    </div>
  )
}

/** Anuncios: lista a la izquierda, el anuncio abierto a la derecha. Abrirlo lo marca como visto. Administradores publican. */
export default function Anuncios({ email, admin, nombres, personas = [], alCambiarVistos }) {
  const [lista, setLista] = useState(null)
  const [vistos, setVistos] = useState([])
  const [sel, setSel] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [editando, setEditando] = useState(null) // 'nuevo' | anuncio

  async function cargar() {
    const [a, v] = await Promise.all([
      supabase.from('anuncios').select('*').order('publicado_en', { ascending: false }),
      supabase.from('anuncios_vistos').select('*'),
    ])
    if (a.error) { toast('No se pudieron cargar los anuncios: ' + a.error.message, true); setLista([]); return }
    setLista(a.data || []); setVistos(v.data || [])
  }
  useEffect(() => { cargar() }, [])

  const visto = id => vistos.some(v => v.anuncio_id === id && v.email === email)
  async function abrir(an) {
    setSel(an.id); setEditando(null)
    if (!visto(an.id)) {
      const { error } = await supabase.from('anuncios_vistos').insert({ anuncio_id: an.id, email })
      if (!error) { setVistos(vs => [...vs, { anuncio_id: an.id, email, visto_en: new Date().toISOString() }]); alCambiarVistos?.() }
    }
  }
  async function borrar(an) {
    if (!window.confirm(`¿Borrar el anuncio “${an.titulo}”? No se puede deshacer.`)) return
    const { error } = await supabase.from('anuncios').delete().eq('id', an.id)
    if (error) { toast(error.message, true); return }
    setSel(null); cargar(); alCambiarVistos?.()
  }

  const filtrada = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (lista || []).filter(a => !q || `${a.titulo} ${a.cuerpo}`.toLowerCase().includes(q))
      .sort((a, b) => (b.fijado - a.fijado) || String(b.publicado_en).localeCompare(String(a.publicado_en)))
  }, [lista, buscar])
  const actual = (lista || []).find(a => a.id === sel)
  const quienesVieron = actual ? vistos.filter(v => v.anuncio_id === actual.id) : []

  if (!lista) return <div className="vacio-chk">Cargando…</div>
  return (
    <div className="anuncios-rh">
      <div className="col-lista">
        <div className="barra">
          <input className="buscar-chk" placeholder="Buscar anuncios…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          {admin && <button className="btn btn-primary btn-sm" onClick={() => { setEditando('nuevo'); setSel(null) }}>＋ Nuevo</button>}
        </div>
        {filtrada.length === 0 && <div className="vacio-chk">{buscar ? 'Ningún anuncio coincide.' : 'Todavía no hay anuncios.'}</div>}
        <ul>
          {filtrada.map(a => (
            <li key={a.id} className={`${sel === a.id ? 'sel' : ''} ${visto(a.id) ? '' : 'nuevo'}`} onClick={() => abrir(a)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && abrir(a)}>
              <div className="titulo">{!visto(a.id) && <span className="punto-nuevo" aria-label="Sin leer" />}{a.fijado && '📌 '}{a.titulo}</div>
              <div className="meta">{nombres[a.autor_email] || a.autor_email || 'BEA'} · {fechaAnuncio(a.publicado_en)}</div>
              <div className="extracto">{a.cuerpo}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="col-detalle">
        {editando ? (
          <FormAnuncio inicial={editando === 'nuevo' ? null : editando} yo={email} onCancelar={() => setEditando(null)} onListo={() => { setEditando(null); cargar() }} />
        ) : actual ? (
          <article>
            <h2>{actual.fijado && '📌 '}{actual.titulo}</h2>
            <div className="meta">{nombres[actual.autor_email] || actual.autor_email || 'BEA'} · {fechaAnuncio(actual.publicado_en)}{actual.editado_en && ' · editado'}</div>
            <div className="cuerpo">{actual.cuerpo}</div>
            {admin && (
              <div className="admin-anuncio">
                <div className="vistos">👁 Visto por {quienesVieron.length} de {personas.length}{quienesVieron.length > 0 && <>: {quienesVieron.map(v => nombres[v.email] || v.email).join(', ')}</>}</div>
                <div className="acciones">
                  <button className="btn btn-outline btn-sm" onClick={() => setEditando(actual)}>Editar</button>
                  <button className="btn btn-outline btn-sm" onClick={() => borrar(actual)}>Borrar</button>
                </div>
              </div>
            )}
          </article>
        ) : <div className="vacio-anuncio"><div className="icono">📣</div>Elige un anuncio para leerlo</div>}
      </div>
    </div>
  )
}
