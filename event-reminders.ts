// Supabase Edge Function — Recordatorios de eventos
// Envía un correo a cada usuario 24h antes de sus eventos
//
// DEPLOY:
//   supabase functions deploy event-reminders
//
// ENV VARS (Supabase Dashboard → Settings → Edge Functions → Secrets):
//   RESEND_API_KEY   → tu clave de Resend (resend.com, plan gratuito: 3000 emails/mes)
//   REMINDER_FROM    → dirección remitente, ej: "Diario Cultural <hola@tudominio.com>"
//                      (con Resend gratuito puedes usar onboarding@resend.dev para pruebas)
//
// PROGRAMAR (SQL Editor de Supabase):
//   Ver bloque SQL al final de este archivo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_URL   = 'https://api.resend.com/emails'
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')!
const REMINDER_FROM = Deno.env.get('REMINDER_FROM') ?? 'Diario Cultural <onboarding@resend.dev>'
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Fecha de mañana en formato YYYY-MM-DD
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  // Obtener eventos de mañana (el service role key ignora RLS)
  const { data: eventsData, error: evErr } = await supabase
    .from('events')
    .select('*')
    .eq('date', tomorrowStr)

  if (evErr) {
    return new Response(JSON.stringify({ error: evErr.message }), { status: 500 })
  }

  if (!eventsData?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No hay eventos mañana' }))
  }

  let sent = 0
  const errors: string[] = []

  for (const ev of eventsData) {
    // Obtener el email del usuario propietario del evento
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(ev.user_id)
    if (userErr || !userData?.user?.email) {
      errors.push(`Sin email para user_id ${ev.user_id}`)
      continue
    }

    const email = userData.user.email

    // Enviar correo con Resend
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    REMINDER_FROM,
        to:      email,
        subject: `${catEmoji(ev.cat)} Mañana: ${ev.title}`,
        html:    buildHtml(ev),
      }),
    })

    if (res.ok) {
      sent++
    } else {
      const body = await res.text()
      errors.push(`Error enviando a ${email}: ${body}`)
    }
  }

  return new Response(
    JSON.stringify({ sent, total: eventsData.length, errors }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})

// ── Helpers ──────────────────────────────────────────────────────────────

function catEmoji(cat: string): string {
  const map: Record<string, string> = {
    Concierto: '🎵', Cine: '🎬', Teatro: '🎭', Exposición: '🖼️', Otro: '✨',
  }
  return map[cat] ?? '🎭'
}

function starsText(rating: number): string {
  if (!rating) return ''
  let s = ''
  for (let i = 1; i <= 5; i++) {
    s += rating >= i ? '★' : rating >= i - 0.5 ? '⯨' : '☆'
  }
  return s
}

function buildHtml(ev: Record<string, string | number>): string {
  const emoji   = catEmoji(ev.cat as string)
  const loc     = [ev.venue, ev.city].filter(Boolean).join(' · ')
  const stars   = ev.rating ? starsText(+ev.rating) : ''
  const mapsBtn = ev.maps_url
    ? `<a href="${ev.maps_url}" style="display:inline-block;margin-top:12px;background:#c9943a;color:#1a1000;text-decoration:none;padding:8px 20px;border-radius:8px;font-size:13px;font-family:system-ui">📍 Ver en mapa</a>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0c10;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0c10;padding:40px 20px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:rgba(22,20,25,.9);border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden">

        <!-- Header band -->
        <tr><td style="background:linear-gradient(135deg,rgba(201,148,58,.18) 0%,rgba(168,127,212,.1) 100%);padding:32px 32px 24px">
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.35)">Recordatorio · Diario Cultural</p>
          <h1 style="margin:0;font-size:28px;font-weight:300;font-style:italic;color:#eee8df;line-height:1.2">${ev.title}</h1>
          <p style="margin:10px 0 0;font-size:13px;color:#c9943a;letter-spacing:.5px">${emoji} ${ev.cat} &nbsp;·&nbsp; Mañana</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:24px 32px 32px">
          ${loc ? `<p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,.5)">📍 ${loc}</p>` : ''}
          ${ev.address ? `<p style="margin:0 0 16px;font-size:12px;color:rgba(255,255,255,.3)">${ev.address}</p>` : ''}
          ${stars ? `<p style="margin:0 0 16px;font-size:18px;color:#e4b96a;letter-spacing:2px">${stars}</p>` : ''}
          ${ev.companions ? `<p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,.4)">👥 ${ev.companions}</p>` : ''}
          ${ev.notes ? `
          <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,.07)">
            <p style="margin:0;font-size:14px;font-style:italic;color:rgba(255,255,255,.55);line-height:1.7">${(ev.notes as string).replace(/\n/g,'<br>')}</p>
          </div>` : ''}
          ${mapsBtn}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,.06)">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,.2)">Diario <em>Cultural</em> &nbsp;·&nbsp; Este correo se envió automáticamente porque tienes un evento mañana.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SQL PARA PROGRAMAR LA FUNCIÓN (pegar en SQL Editor de Supabase)
   Ejecuta todos los días a las 09:00 UTC (11:00 hora española en verano)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Habilitar extensiones (si no están ya activas)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Programar ejecución diaria a las 09:00 UTC
select cron.schedule(
  'diario-cultural-recordatorios',          -- nombre del job
  '0 9 * * *',                              -- cron: cada día a las 09:00 UTC
  $$
  select net.http_post(
    url     := 'https://[TU_PROJECT_REF].supabase.co/functions/v1/event-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer [TU_ANON_KEY]',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para ver los jobs programados:
-- select * from cron.job;

-- Para eliminar el job si necesitas:
-- select cron.unschedule('diario-cultural-recordatorios');

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PASOS DE CONFIGURACIÓN:
   1. Crea cuenta en resend.com (gratis hasta 3000 emails/mes)
   2. Obtén tu API key en resend.com/api-keys
   3. En Supabase Dashboard → Edge Functions → Secrets, añade:
        RESEND_API_KEY  = re_xxxxxxxxxxxxxxxxxx
        REMINDER_FROM   = "Diario Cultural <hola@tudominio.com>"
   4. Despliega: supabase functions deploy event-reminders
   5. Ejecuta el SQL de arriba en SQL Editor (reemplaza PROJECT_REF y ANON_KEY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
