export const config = { runtime: "edge" };

/**
 * Foto de perfil do WhatsApp, via proxy.
 *
 * Duas razões para não chamar a Z-API direto do browser:
 *  1. o Client-Token ficaria no bundle público;
 *  2. a Z-API devolve uma URL do CDN do WhatsApp (`pps.whatsapp.net`) que
 *     **expira** — gravada no banco, ela para de funcionar em alguns dias.
 *
 * Com o proxy, `<img src="/api/whatsapp-photo?phone=55...">` sempre resolve o
 * link fresco na hora. Com `?json=1` devolve `{ link }` em vez da imagem, para
 * quem quiser persistir a URL (ex.: o formulário de cadastro).
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
  const instance = process.env.ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;

  if (!instance || !token || !clientToken) {
    return json({ error: "Z-API não configurada no ambiente" }, 500);
  }

  const url = new URL(req.url);
  const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
  const asJson = url.searchParams.get("json") === "1";

  if (phone.length < 10) {
    return json({ error: "phone invalido" }, 400);
  }

  let link = null;
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${instance}/token/${token}/profile-picture?phone=${phone}`,
      { headers: { "Client-Token": clientToken } },
    );
    if (res.ok) {
      const data = await res.json();
      // A Z-API responde `{ "link": "https://pps.whatsapp.net/..." }`.
      link = data?.link ?? null;
    }
  } catch {
    /* rede/instancia fora do ar — cai no 404 abaixo */
  }

  if (!link) {
    return asJson ? json({ link: null }, 404) : new Response("sem foto", { status: 404 });
  }

  if (asJson) return json({ link });

  // Stream da imagem: o browser nunca vê o CDN do WhatsApp, então não há
  // hotlink bloqueado nem URL expirada em cache.
  const img = await fetch(link);
  if (!img.ok) return new Response("sem foto", { status: 404 });

  return new Response(img.body, {
    status: 200,
    headers: {
      "Content-Type": img.headers.get("content-type") ?? "image/jpeg",
      // O link expira; 1h de cache evita bater na Z-API a cada render.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
