export const config = { runtime: "edge" };

/**
 * Dispara AGORA o envio da confirmacao de um pedido agendado.
 *
 * O `WF_Agendamento_Liberar` do n8n roda num Schedule de 5 minutos. Marcar
 * `liberado_em` no painel so colocava o agendamento na fila: o cliente recebia
 * os botoes de confirmar/cancelar em ate 5 min, e o balcao ficava sem saber se
 * tinha falhado ou se era so demora — clicando de novo por via das duvidas.
 *
 * Este proxy chama o webhook `agendamento-liberar`, que entra no MESMO fluxo do
 * tique (checa estoque, desvia para revisao manual quando falta item, manda o
 * option-list e grava `confirmacao_enviada_em`). Nada de regra duplicada aqui:
 * quando `agendado_id` vai no corpo, o workflow filtra so aquele agendamento.
 *
 * O Schedule continua ativo como rede de seguranca — se este disparo falhar, o
 * proximo tique pega o agendamento do mesmo jeito.
 *
 * Opcional na Vercel: N8N_WEBHOOK_BASE (default: https://n8n.faturemais.shop/webhook).
 */

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || "https://n8n.faturemais.shop/webhook";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { agendado_id } = await req.json().catch(() => ({}));
  if (!agendado_id) return json({ error: "agendado_id e obrigatorio" }, 400);

  let r;
  try {
    r = await fetch(`${N8N_BASE}/agendamento-liberar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agendado_id, origem: "painel" }),
    });
  } catch (e) {
    return json({ error: "n8n inacessivel: " + String(e && e.message) }, 502);
  }

  const texto = await r.text();
  if (!r.ok) {
    return json({ error: "n8n respondeu " + r.status, detalhe: texto.slice(0, 300) }, r.status);
  }

  // Webhook responde onReceived: 200 significa "aceito e processando", nao
  // "cliente ja recebeu". A tela confirma pelo refetch de `confirmacao_enviada_em`.
  return json({ ok: true, resposta: texto.slice(0, 300) });
}
