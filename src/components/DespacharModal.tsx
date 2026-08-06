import { useState } from "react";
import { Truck, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import CodigoPedido from "@/components/CodigoPedido";
import EnderecoLink from "@/components/EnderecoLink";
import { type Pedido, type EntregadorFull, formatCurrency, pedidoNumero } from "@/lib/pedido";

/**
 * Escolhe (ou troca) o entregador de um pedido em separação. Usado pelo
 * Kanban de Pedidos e pela ficha do cliente — fonte única, pra não repetir
 * a regra de despacho (já divergiu antes neste projeto).
 */
export default function DespacharModal({
  pedido,
  entregadores,
  open,
  onClose,
  onDone,
}: {
  pedido: Pedido;
  entregadores: EntregadorFull[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const despachoExistenteInicial = pedido.despacho_entrega?.[0] ?? null;
  const [selectedId, setSelectedId] = useState<string>(despachoExistenteInicial?.entregador_id ?? "");
  const [loading, setLoading] = useState(false);

  async function confirmar() {
    setLoading(true);
    try {
      // Calcular valor_total a partir dos preços do estoque (se ainda não tiver)
      let valorTotal = pedido.valor_total;
      if (!valorTotal && pedido.itens_pedido?.length) {
        const nomes = pedido.itens_pedido.map((i) => i.item).filter(Boolean);
        const { data: estoqueItems } = await externalSupabase
          .from("estoque")
          .select("nome, preco")
          .in("nome", nomes);
        if (estoqueItems?.length) {
          const precoMap: Record<string, number> = {};
          estoqueItems.forEach((e) => { if (e.nome && e.preco != null) precoMap[e.nome] = e.preco; });
          const total = pedido.itens_pedido.reduce((s, i) => s + (precoMap[i.item] ?? 0) * i.quantidade, 0);
          if (total > 0) valorTotal = total;
        }
      }

      // O status NÃO é mexido aqui de propósito.
      // Escolher o entregador deixou de significar "saiu para entrega" na reforma
      // de 03/08 — quem move o pedido para `saiu_para_entrega` é o próprio
      // entregador, pelo botão do WhatsApp (WF5) ou pelo painel dele. O painel
      // continuava pulando essa etapa e fechando a rua sozinho: o cliente recebia
      // "saiu para entrega" antes de alguém sair, e o `saiu_em` do despacho ficava
      // nulo. Quem põe o pedido em `em_separacao` é o `Desp_UpdateStatus` do n8n.
      if (valorTotal && !pedido.valor_total) {
        const { error: errPedido } = await externalSupabase
          .from("pedidos")
          .update({ valor_total: valorTotal })
          .eq("id", pedido.id);
        if (errPedido) throw new Error(errPedido.message);
      }

      // Decrementar estoque
      if (pedido.itens_pedido?.length) {
        for (const item of pedido.itens_pedido) {
          if (!item.item || !item.quantidade) continue;
          const { data: estoqueRow } = await externalSupabase
            .from("estoque")
            .select("id, quantidade")
            .eq("nome", item.item)
            .maybeSingle();
          if (estoqueRow) {
            await externalSupabase
              .from("estoque")
              .update({ quantidade: Math.max(0, (estoqueRow.quantidade ?? 0) - item.quantidade) })
              .eq("id", estoqueRow.id);
          }
        }
      }

      if (selectedId) {
        const despachoExistente = pedido.despacho_entrega?.[0];
        if (despachoExistente) {
          await externalSupabase
            .from("despacho_entrega")
            .update({ entregador_id: selectedId, saiu_em: null, chegou_em: null, status_entrega: "despachado" })
            .eq("id", despachoExistente.id);
        } else {
          await externalSupabase.from("despacho_entrega").insert({
            pedido_id: pedido.id,
            entregador_id: selectedId,
            status_entrega: "despachado",
          });
        }

        // Aciona o MESMO workflow que o grupo Balcão aciona (Despacho_Motoboy).
        //
        // Antes o painel mandava a ficha por `send-text`, e texto puro não tem
        // botão: o motoboy despachado pelo painel recebia um bilhete sem os
        // botões "Sair para entrega → Cheguei → Entreguei" que o WF5 alimenta,
        // enquanto o despachado pelo grupo recebia. Mesma mensagem, mesmo botão,
        // mesma cadeia de status — a montagem continua morando só no n8n
        // (`Desp_Montar_Msg`).
        //
        // Só o entregador é avisado aqui. O cliente é avisado quando o entregador
        // de fato sai — regra de 03/08.
        try {
          const r = await fetch("/api/despachar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pedido_id: pedido.id, entregador_id: selectedId }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(`${r.status}${d?.error ? ` — ${d.error}` : ""}`);
          }
        } catch (e) {
          toast({
            title: "Entregador não foi avisado",
            description: `O despacho foi salvo, mas o WhatsApp não saiu (${
              e instanceof Error ? e.message : "erro"
            }). Chame o entregador.`,
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Entregador acionado!",
        description: "Recebeu a ficha e os botões no WhatsApp. O pedido vai para a rua quando ele tocar em “Sair para entrega”.",
      });
      onDone();
      onClose();

      // Fire-and-forget: envia fotos dos produtos para o cliente
      // Roda APÓS modal fechar, nunca bloqueia nem quebra o fluxo
      const telefoneCliente2 = pedido.clientes?.telefone;
      if (telefoneCliente2 && pedido.itens_pedido?.length) {
        (async () => {
          try {
            const nomes2 = pedido.itens_pedido.map((i) => i.item).filter(Boolean);
            const { data: imgs } = await externalSupabase
              .from("estoque")
              .select("nome, imagem_url")
              .in("nome", nomes2)
              .not("imagem_url", "is", null);
            if (!imgs?.length) return;
            const phone2 = telefoneCliente2.replace(/\D/g, "");
            for (const img of imgs) {
              if (!img.imagem_url) continue;
              const item = pedido.itens_pedido.find((i) => i.item === img.nome);
              const caption = item ? `${item.quantidade}x ${img.nome}` : img.nome;
              await fetch("/api/notify-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: phone2, image: img.imagem_url, caption }),
              });
            }
          } catch { /* silently fail */ }
        })();
      }
    } catch (err: unknown) {
      toast({ title: "Erro ao despachar", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {despachoExistenteInicial ? "Mudar entregador" : "Despachar pedido"}
            <CodigoPedido codigo={pedidoNumero(pedido)} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cliente: <span className="font-medium text-foreground">{pedido.clientes?.nome ?? "—"}</span>
          </p>
          {pedido.endereco && (
            <p className="text-sm text-muted-foreground">
              Endereço: <EnderecoLink endereco={pedido.endereco} icone={false} linhas={0} />
            </p>
          )}
          {pedido.itens_pedido?.filter(i => i.item).length > 0 && (
            <div className="bg-secondary rounded-lg px-3 py-2 text-sm space-y-0.5">
              {pedido.itens_pedido.filter(i => i.item).map((i, idx) => (
                <div key={idx} className="flex justify-between">
                  <span>{i.item}</span>
                  <span className="font-medium text-muted-foreground">×{i.quantidade}</span>
                </div>
              ))}
              {pedido.valor_total != null && (
                <div className="border-t border-border pt-1 mt-1 flex justify-between font-semibold">
                  <span>Total</span><span>{formatCurrency(pedido.valor_total)}</span>
                </div>
              )}
              {pedido.pagamento && (
                <p className="text-xs text-muted-foreground pt-0.5">Pgto: {pedido.pagamento}</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Entregador (opcional)</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar entregador..." />
              </SelectTrigger>
              <SelectContent>
                {entregadores.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
            Despachar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
