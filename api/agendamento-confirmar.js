export const config = { runtime: "edge" };

/**
 * Confirma (ou descarta) um pedido agendado a partir do painel.
 *
 * Proxy para o webhook `agendamento-confirmar` do n8n — de proposito. Toda a
 * conversao "agendado -> pedido" ja existe la (WF_Agendamento_Confirmar:
 * cria o pedido, cria os itens, baixa o agendamento, avisa o cliente e o grupo
 * Balcao). Reimplementar isso no painel criaria uma segunda copia da regra, que
 * e exatamente como o painel e o n8n ja divergiram antes na mensagem do
 * entregador e na confirmacao de entrega.
 *
 * O proxy existe por dois motivos: nao expor a URL do n8n no bundle publico e
 * nao depender de CORS no webhook.
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

  const { agendado_id, acao, telefone, nome } = await req.json().catch(() => ({}));
  if (!agendado_id) return json({ error: "agendado_id e obrigatorio" }, 400);

  let r;
  try {
    r = await fetch(`${N8N_BASE}/agendamento-confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agendado_id,
        acao: acao === "NAO" ? "NAO" : "OK",
        telefone: telefone || "",
        nome: nome || "Cliente",
        origem: "painel",
      }),
    });
  } catch (e) {
    return json({ error: "n8n inacessivel: " + String(e && e.message) }, 502);
  }

  const texto = await r.text();
  if (!r.ok) return json({ error: "n8n respondeu " + r.status, detalhe: texto.slice(0, 300) }, r.status);

  // O webhook responde onReceived (corpo vazio): 200 aqui significa "aceito e
  // processando", nao "pedido criado". A tela confirma pelo refetch.
  return json({ ok: true, resposta: texto.slice(0, 300) });
}
