import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { PEDIDO_SELECT, type Pedido, type EntregadorFull } from "@/lib/pedido";
import FichaPedido from "@/components/FichaPedido";

/**
 * Rota `/pedido/:codigo` — abre a ficha completa a partir do link que o n8n
 * manda no WhatsApp (grupo Balcão e bilhete do entregador).
 *
 * O parâmetro é o `pedidos.codigo` legível (`04ago1157`), mas aceita também o
 * uuid: pedidos criados antes do código existirem circularam com o id na mão,
 * e link velho que morre é pior que uma consulta a mais.
 */

async function fetchPedido(chave: string): Promise<Pedido | null> {
  const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave);
  const { data, error } = await externalSupabase
    .from("pedidos")
    .select(PEDIDO_SELECT)
    .eq(ehUuid ? "id" : "codigo", chave)
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

export default function PedidoLink() {
  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();

  const { data: pedido, isLoading, isError } = useQuery({
    queryKey: ["pedido-link", codigo],
    queryFn: () => fetchPedido(codigo!),
    enabled: !!codigo,
  });

  const { data: entregadores } = useQuery({
    queryKey: ["ficha-entregadores"],
    queryFn: fetchEntregadores,
    staleTime: 5 * 60_000,
  });

  // Fechar a ficha não pode deixar tela vazia: o link é a primeira página que a
  // pessoa abre, então não há histórico para voltar.
  const voltar = () => navigate(role === "entregador" ? "/entregas" : "/pedidos", { replace: true });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Abrindo pedido {codigo}...</p>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          {isError ? "Erro ao carregar o pedido." : `Pedido ${codigo} não encontrado.`}
        </p>
        <button onClick={voltar} className="text-sm font-semibold text-primary underline">
          Ir para a fila de pedidos
        </button>
      </div>
    );
  }

  return (
    <FichaPedido
      pedido={pedido}
      entregadores={entregadores ?? []}
      open
      onClose={voltar}
    />
  );
}
