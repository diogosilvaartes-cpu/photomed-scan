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

// Mesma instancia que o n8n usa em todos os workflows. Fica como FALLBACK porque
// as variaveis da Vercel ja apontaram para uma instancia morta (`3F0A5084...`) e o
// sintoma era invisivel: o painel gravava o status, ninguem recebia WhatsApp e nao
// havia erro em lugar nenhum. Com o fallback, trocar a instancia no n8n e esquecer
// a Vercel deixa de derrubar o aviso ao cliente. A env var continua tendo prioridade.
const ZAPI_FALLBACK = {
  instance: "3F72930BEECE1197F3787A11598E52BD",
  token: "3055714DB63E8E333BAD6C8D",
  clientToken: "F97dd17bb07654383b51e4ee0fb3eb838S",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const instance = process.env.ZAPI_INSTANCE || ZAPI_FALLBACK.instance;
  const token = process.env.ZAPI_TOKEN || ZAPI_FALLBACK.token;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || ZAPI_FALLBACK.clientToken;

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
      // ID de grupo ("1203...-group") não pode passar pelo replace de não-dígitos:
      // o sufixo é parte do endereço e sem ele a mensagem vai para um número solto.
      body: JSON.stringify({
        phone: String(phone).includes("-group")
          ? String(phone).trim()
          : String(phone).replace(/\D/g, ""),
        message,
      }),
    },
  );

  const data = await r.json().catch(() => ({}));

  // A Z-API responde 200 com corpo de erro em alguns casos (numero invalido, sessao
  // caida). Tratar isso como sucesso foi o que manteve a falha silenciosa: o front
  // so olha o status HTTP. Aqui o erro vira status de verdade.
  if (r.ok && data && (data.error || data.message === "error")) {
    return json({ error: data.error || "Z-API recusou o envio", zapi: data }, 502);
  }

  return json(data, r.ok ? 200 : r.status);
}
