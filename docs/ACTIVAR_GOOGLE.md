# Activar "Entrar con Google"

La app ya trae el botón **Entrar con Google (correo BEA)**. Aparece solo cuando Google está activado en Supabase, así que no hay que tocar código: basta con hacer estos pasos una vez. Los hace alguien con permiso de **Owner/Admin** en Supabase y acceso a **Google Cloud** con la cuenta de BEA.

**Costo:** $0. El inicio de sesión con Google es gratis en Google Cloud y en el plan gratuito de Supabase.

## 1. Google Cloud: crear el cliente OAuth (≈10 min)

1. Entra a <https://console.cloud.google.com> con una cuenta `@bioconstruccion.com.mx` y crea un proyecto, por ejemplo "BEA Estimaciones". Si ya hay uno de BEA, sirve ese.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**
   - Tipo de usuario: **Interno**. Así solo pueden entrar cuentas de BEA.
   - Nombre de la app: "BEA Estimaciones". Correo de asistencia: el del PMO.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**
   - Tipo: **Aplicación web**
   - Orígenes de JavaScript autorizados: `https://pmanagement-bea.github.io`
   - URI de redireccionamiento autorizados: `https://klpqrnxaeyajutzllsyq.supabase.co/auth/v1/callback`
4. Copia el **ID de cliente** y el **Secreto del cliente**. No los mandes por chat ni correo: pégalos directo en Supabase en el paso 2.

## 2. Supabase: activar Google (≈3 min)

1. **Authentication → Sign In / Providers → Google**: actívalo y pega el ID y el secreto del paso anterior. Guarda.
2. **Authentication → URL Configuration**
   - **Site URL:** `https://pmanagement-bea.github.io/bea-estimaciones-app/`
   - **Redirect URLs:** agrega `https://pmanagement-bea.github.io/bea-estimaciones-app/`

   Este paso también arregla los enlaces de los correos de Supabase, que hoy apuntan a `localhost:3000`.

## 3. Probar

Abre la app y aparece el botón **Entrar con Google**. Entra con una cuenta de BEA.

- Si la persona está activa en el **Directorio**, entra con el rol y el área que tiene ahí. La primera vez, la cuenta se crea sola.
- Si no está en el Directorio o está inactiva, la app le dice que pida a su coordinador que la agregue. No se crea ninguna cuenta.
- Quien ya tenía cuenta con contraseña puede seguir usándola, o entrar con Google con el mismo correo.
