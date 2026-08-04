export const config = { runtime: "edge" };

/**
 * Envia texto no WhatsApp pela Z-API.
 *
 * A instancia e os tokens vem do ambiente (mesmas variaveis do
 * `whatsapp-photo.js`). Antes estavam hardcoded aqui — e apontavam para a
 * instancia `3F0A5084...`, que morreu: TODA notificacao do painel era enviada
 * para o vazio, em silencio, porque as chamadas no front estao dentro de
 * `catch {}`.
 *
 * Exige na Vercel: ZAPI_INSTANCE, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN.
 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const instance = process.env.ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;

  if (!instance || !token || !clientToken) {
    return json({ error: "Z-API nao configurada no ambiente" }, 500);
  }

  const { phone, message } = await req.json();

  if (!phone || !message) {
    return json({ error: "phone e message sao obrigatorios" }, 400);
  }

  const r = await fetch(
    `https://api.z-api.io/instances/${instance}/token/${token}/send-text`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": clientToken,
      },
      body: JSON.stringify({ phone: String(phone).replace(/\D/g, ""), message }),
    },
  );

  const data = await r.json().catch(() => ({}));
  return json(data, r.ok ? 200 : r.status);
}
