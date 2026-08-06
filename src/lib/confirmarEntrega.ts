import { externalSupabase } from "@/integrations/supabase/external-client";
import { type Pedido, type ItemPagamento } from "@/lib/pedido";
import { notifyWhatsApp } from "@/lib/notify";

/** Se o entregador já registrou o pagamento pelo celular dele, não vale perguntar de novo. */
export function pagamentoJaRegistrado(pedido: Pedido): boolean {
  return !!pedido.despacho_entrega?.[0]?.pagamento_recebido?.length;
}

/**
 * Fecha a entrega: grava `status = entregue` (+ o pagamento que o balcão
 * informou, se algum), baixa `despacho_entrega` quando existe, e avisa o
 * cliente no WhatsApp. Única implementação — Kanban, aba "Na rua" e a ficha
 * do cliente chamam esta função, para não abrir mais uma cópia da regra (já
 * divergiu antes neste projeto entre essas mesmas telas).
 */
export async function confirmarEntregaPedido(
  pedido: Pedido,
  pagamentos: ItemPagamento[] | null,
  operador: Record<string, unknown>,
): Promise<{ avisouCliente: boolean }> {
  const despacho = pedido.despacho_entrega?.[0];

  await externalSupabase
    .from("pedidos")
    .update({ status: "entregue", pagamento_recebido: pagamentos, ...operador })
    .eq("id", pedido.id);

  if (despacho) {
    await externalSupabase
      .from("despacho_entrega")
      .update({ status_entrega: "entregue", chegou_em: new Date().toISOString() })
      .eq("id", despacho.id);
  }

  const telefone = pedido.clientes?.telefone;
  const avisouCliente = telefone ? await notifyWhatsApp(telefone, "✅ Chegou!") : true;
  return { avisouCliente };
}
