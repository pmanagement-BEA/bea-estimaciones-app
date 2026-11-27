import { useEffect, useState } from 'react'
import { puedeVerDesempeno, permisoGuardado } from '../lib/desempeno'

/** ¿Puede ver Desempeño? null = aún no se sabe. Usa de inmediato el último resultado guardado de ese usuario
 *  (así la barra y el Inicio no brincan al cargar) y luego lo confirma con la base. */
export function useVeDesempeno(email) {
  const [ve, setVe] = useState(() => permisoGuardado(email))
  useEffect(() => {
    if (!email) return
    let vivo = true
    setVe(v => v ?? permisoGuardado(email))
    puedeVerDesempeno(email).then(r => { if (vivo) setVe(r) })
    return () => { vivo = false }
  }, [email])
  return ve
}
