import { useEffect, useState } from 'react'
import { permisosProyecto } from '../lib/cierre'

/** true si el usuario no está asignado al proyecto (ni es dueño, líder o coordinador): lo ve en solo lectura. */
export function useAjeno(project, profile) {
  const [ajeno, setAjeno] = useState(false)
  useEffect(() => {
    if (!project?.id || !profile?.id) return
    permisosProyecto(project, profile).then(p => setAjeno(!p.todo && p.roles.length === 0 && profile.role !== 'lectura'))
  }, [project?.id, project?.user_id, profile?.id, profile?.role])
  return ajeno
}

export const AVISO_AJENO = 'No estás asignado a este proyecto: lo ves en solo lectura. Si debías estar, pide al líder o al coordinador que te agregue al equipo.'
