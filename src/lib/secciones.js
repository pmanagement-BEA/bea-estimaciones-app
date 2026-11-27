// Secciones de la app: las usan el Inicio (tarjetas) y la barra de arriba (nombre de la sección actual).
// grupo: color de la tarjeta (verde oscuro · burgundy · azul marino). soloDesempeno: solo coordinación, PMO y Dirección.
export const GRUPOS = [
  { id: 'operacion', nombre: 'Operación' },
  { id: 'tiempo', nombre: 'Tiempo' },
  { id: 'gestion', nombre: 'Gestión' },
]

export const SECCIONES = [
  { ruta: '/proyectos', nombre: 'Estimaciones', desc: 'Tus proyectos, borradores e historial', grupo: 'operacion', icono: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', activa: p => p.startsWith('/proyectos') || p.startsWith('/projects') },
  { ruta: '/proyecciones', nombre: 'Proyecciones', desc: 'Lo que se piensa cobrar mes a mes', grupo: 'operacion', icono: 'M3 17l6-6 4 4 8-8M15 7h6v6', activa: p => p.startsWith('/proyecciones') },
  { ruta: '/reporte-cx', nombre: 'Reporte Cx', desc: 'Reporte mensual y correo al líder', grupo: 'operacion', icono: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4', activa: p => p.startsWith('/reporte-cx') },
  { ruta: '/track', nombre: 'Track', desc: 'Registro de horas por concepto', grupo: 'tiempo', icono: 'M3 12h4l3-8 4 16 3-8h4', activa: p => p.startsWith('/track') },
  { ruta: '/checador', nombre: 'Checador', desc: 'Entradas, salidas y ausencias', grupo: 'tiempo', icono: 'M12 5a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM12 9v4l2.5 2.5M9 2h6', activa: p => p.startsWith('/checador') },
  { ruta: '/dashboard', nombre: 'Dashboard', desc: 'Avance y cobro de los proyectos', grupo: 'gestion', icono: 'M4 20V10M10 20V4M16 20v-7M22 20H2', activa: p => p.startsWith('/dashboard') },
  { ruta: '/desempeno', nombre: 'Desempeño', desc: 'Indicadores en vivo y RC-OP-43', grupo: 'gestion', icono: 'M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 12l5-3', activa: p => p.startsWith('/desempeno'), soloDesempeno: true },
  { ruta: '/directorio', nombre: 'Directorio', desc: 'Equipo, áreas y permisos', grupo: 'gestion', icono: 'M9 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2', activa: p => p.startsWith('/directorio') },
]

export const seccionDe = ruta => SECCIONES.find(s => s.activa(ruta)) || null
