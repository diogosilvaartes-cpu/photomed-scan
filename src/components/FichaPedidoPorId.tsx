import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { PEDIDO_SELECT, type Pedido, type EntregadorFull } from "@/lib/pedido";
import FichaPedido from "./FichaPedido";

/**
 * Abre a mesma `FichaPedido` da aba Pedidos a partir de um `pedido_id`.
 *
 * A fila de Pedidos já carrega o pedido inteiro e usa `FichaPedido` direto.
 * As outras telas (Dashboard, histórico do entregador, ficha do cliente)
 * só têm o ID em mãos — este wrapper busca o resto sob demanda, para que a
 * ficha seja idêntica em todo o app sem obrigar cada página a mudar o select.
 */

async function fetchPedido(id: string): Promise<Pedido | null> {
  const { data, error } = await externalSupabase
    .from("pedidos")
    .select(PEDIDO_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Pedido) ?? null;
}

async function fetchEntregadores(): Promise<EntregadorFull[]> {
  const { data, error } = await externalSupabase
    .from("entregadores")
    .select("id, nome, telefone, ativo, user_id");
  if (error) throw error;
  return (data as EntregadorFull[]) ?? [];
}

export default function FichaPedidoPorId({
  pedidoId,
  open,
  onClose,
}: {
  pedidoId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: pedido, isLoading, isError } = useQuery({
    queryKey: ["ficha-pedido", pedidoId],
    queryFn: () => fetchPedido(pedidoId!),
    enabled: !!pedidoId && open,
  });

  // Lista pequena e quase estática — compartilhada entre todas as fichas.
  const { data: entregadores } = useQuery({
    queryKey: ["ficha-entregadores"],
    queryFn: fetchEntregadores,
    staleTime: 5 * 60_000,
    enabled: open,
  });

  if (!open || !pedidoId) return null;

  if (!pedido) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Ficha do pedido</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            {isLoading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <p className="text-sm">Carregando ficha...</p>
              </>
            ) : (
              <p className="text-sm">
                {isError ? "Erro ao carregar a ficha." : "Pedido não encontrado."}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FichaPedido
      pedido={pedido}
      entregadores={entregadores ?? []}
      open={open}
      onClose={onClose}
    />
  );
}
