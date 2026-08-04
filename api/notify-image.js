export const config = { runtime: "edge" };

/**
 * Envia imagem no WhatsApp pela Z-API. Ver `notify-client.js` — mesma correcao:
 * instancia e tokens saem do ambiente, nao mais hardcoded (apontavam para a
 * instancia morta `3F0A5084...`).
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

  const { phone, image, caption } = await req.json();

  if (!phone || !image) {
    return json({ error: "phone e image sao obrigatorios" }, 400);
  }

  const r = await fetch(
    `https://api.z-api.io/instances/${instance}/token/${token}/send-image`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": clientToken,
      },
      body: JSON.stringify({
        phone: String(phone).replace(/\D/g, ""),
        image,
        caption: caption ?? "",
      }),
    },
  );

  const data = await r.json().catch(() => ({}));
  return json(data, r.ok ? 200 : r.status);
}
