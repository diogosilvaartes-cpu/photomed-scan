export const config = { runtime: "edge" };

/**
 * Aciona o entregador a partir do painel — proxy para o webhook
 * `despachar-pedido` do n8n (workflow Despacho_Motoboy).
 *
 * POR QUE PROXY, E NAO UM send-text DAQUI:
 * o painel mandava a ficha por `/api/notify-client`, que usa `send-text`. Texto
 * puro nao tem botao. Quem despachava pelo grupo Balcao gerava um
 * `send-option-list` com o botao "🛵 Sair para entrega" — o mesmo botao que
 * alimenta o WF5_Status_Entregador (saiu → cheguei → entreguei). Resultado: o
 * motoboy tinha a cadeia por botao quando o despacho vinha do WhatsApp e nao
 * tinha nada quando vinha do painel, e o balcao nao sabia por que.
 *
 * Agora os dois caminhos passam pelo MESMO workflow: mesma mensagem
 * (`Desp_Montar_Msg`), mesmo botao, mesma cadeia de status. Terceira vez que o
 * painel duplicava regra do n8n e as copias divergiam em silencio — ver tambem
 * `agendamento-confirmar.js`.
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

  const { pedido_id, entregador_id } = await req.json().catch(() => ({}));
  if (!pedido_id || !entregador_id) {
    return json({ error: "pedido_id e entregador_id sao obrigatorios" }, 400);
  }

  let r;
  try {
    r = await fetch(`${N8N_BASE}/despachar-pedido`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido_id, entregador_id, origem: "painel" }),
    });
  } catch (e) {
    return json({ error: "n8n inacessivel: " + String(e && e.message) }, 502);
  }

  const texto = await r.text();
  if (!r.ok) {
    return json({ error: "n8n respondeu " + r.status, detalhe: texto.slice(0, 300) }, r.status);
  }

  // O webhook responde onReceived: 200 significa "aceito", nao "entregador ja
  // recebeu". A tela confirma pelo refetch, como no agendamento.
  return json({ ok: true, resposta: texto.slice(0, 300) });
}
