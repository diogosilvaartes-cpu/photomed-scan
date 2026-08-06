export const config = { runtime: "edge" };

/**
 * "Saiu para entrega" e "Cheguei ao local" — o MESMO caminho que o WhatsApp usa.
 *
 * Existiam dois caminhos para o mesmo evento, e só um avisava o cliente:
 *
 *  · WhatsApp: o entregador toca no botão -> webhook do WF5_Status_Entregador ->
 *    marca a hora, NOTIFICA O CLIENTE, atualiza o status e manda o próximo botão.
 *  · Painel:   o entregador tocava no botão -> UPDATE direto no Supabase + um
 *    fetch próprio para a Z-API. O status mudava, mas o aviso ao cliente ia por
 *    fora do n8n e não chegava.
 *
 * Agora o painel entra pelo mesmo webhook. O n8n continua sendo o único lugar
 * que decide o que o cliente recebe — nada de uma segunda cópia da mensagem
 * aqui, que é exatamente como os dois lados já divergiram antes.
 *
 * Os guards do WF5 (`saiu_em=is.null`, `chegou_em=is.null`) garantem que clique
 * repetido não vira aviso duplicado. Por isso o painel NÃO grava a hora antes de
 * chamar: se gravasse, o guard veria "já registrado" e engoliria a notificação.
 *
 * Opcional na Vercel: N8N_WEBHOOK_BASE (default: https://n8n.faturemais.shop/webhook).
 */

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || "https://n8n.faturemais.shop/webhook";

const ROTAS = {
  saiu: "saiu-entrega",
  chegou: "cheguei-local",
  entregue: "entrega-realizada",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { pedido_id, evento } = await req.json().catch(() => ({}));
  if (!pedido_id) return json({ error: "pedido_id e obrigatorio" }, 400);

  const rota = ROTAS[evento];
  if (!rota) {
    return json({ error: "evento invalido; use saiu, chegou ou entregue" }, 400);
  }

  // Os webhooks do WF5 são GET com o id na query — foram feitos para o botão do
  // WhatsApp, que só sabe abrir link.
  let r;
  try {
    r = await fetch(`${N8N_BASE}/${rota}?pedido_id=${encodeURIComponent(pedido_id)}`, {
      method: "GET",
    });
  } catch (e) {
    return json({ error: "n8n inacessivel: " + String(e && e.message) }, 502);
  }

  const texto = await r.text();
  if (!r.ok) {
    return json({ error: "n8n respondeu " + r.status, detalhe: texto.slice(0, 300) }, r.status);
  }

  return json({ ok: true, resposta: texto.slice(0, 300) });
}
