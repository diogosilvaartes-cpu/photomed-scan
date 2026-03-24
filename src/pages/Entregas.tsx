import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, User, MapPin, Phone, Package, Loader2,
  CheckCircle, Clock, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  novo: { label: "Novo", color: "bg-blue-100 text-blue-700 border-blue-200" },
  confirmado: { label: "Confirmado", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  em_separacao: { label: "Em separação", color: "bg-orange-100 text-orange-700 border-orange-200" },
  saiu_para_entrega: { label: "Saiu p/ entrega", color: "bg-purple-100 text-purple-700 border-purple-200" },
  entregue: { label: "Entregue", color: "bg-green-100 text-green-700 border-green-200" },
  cancelado: { label: "Cancelado", color: "bg-red-100 text-red-700 border-red-200" },
};

const STATUS_ENTREGA_CONFIG: Record<string, { label: string; color: string }> = {
  despachado: { label: "Despachado", color: "bg-purple-100 text-purple-700" },
  entregue: { label: "Entregue", color: "bg-green-100 text-green-700" },
};

const PROXIMOS_STATUS: Record<string, string[]> = {
  novo: ["confirmado", "cancelado"],
  confirmado: ["em_separacao", "cancelado"],
  em_separacao: ["saiu_para_entrega", "pronto_para_retirada"],
  saiu_para_entrega: ["entregue"],
};

type Entregador = { id: string; nome: string; ativo: boolean };

type DespachoEntrega = {
  id: string;
  entregador_id: string | null;
  status_entrega: string;
  observacao: string | null;
  enviado_em: string;
  entregue_em: string | null;
};

type PedidoEntrega = {
  id: string;
  cliente_id: string;
  resumo: string | null;
  status: string;
  endereco: string | null;
  valor_total: number | null;
  pagamento: string | null;
  pessoa_recebimento: string | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string | null; telefone: string } | null;
  itens_pedido: { item: string; quantidade: number }[];
  despacho_entrega: DespachoEntrega[];
};

async function fetchEntregasAdmin(): Promise<PedidoEntrega[]> {
  const { data, error } = await externalSupabase
    .from("pedidos")
    .select("*, clientes(nome, telefone), itens_pedido(item, quantidade), despacho_entrega(*)")
    .eq("tipo_fulfillment", "entrega")
    .not("status", "in", '("retirado","cancelado")')
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PedidoEntrega[];
}

async function fetchEntregasEntregador(entregadorId: string): Promise<PedidoEntrega[]> {
  // Get despachos for this entregador
  const { data: despachos, error: de } = await externalSupabase
    .from("despacho_entrega")
    .select("pedido_id")
    .eq("entregador_id", entregadorId)
    .eq("status_entrega", "despachado");
  if (de) throw de;

  const pedidoIds = (despachos ?? []).map((d) => d.pedido_id);
  if (!pedidoIds.length) return [];

  const { data, error } = await externalSupabase
    .from("pedidos")
    .select("*, clientes(nome, telefone), itens_pedido(item, quantidade), despacho_entrega(*)")
    .in("id", pedidoIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PedidoEntrega[];
}

async function fetchEntregadores(): Promise<Entregador[]> {
  const { data, error } = await externalSupabase
    .from("entregadores")
    .select("id, nome, ativo")
    .eq("ativo", true)
    .order("nome");
  if (error) throw error;
  return data ?? [];
}

function StatusBadge({ status, config }: { status: string; config: Record<string, { label: string; color: string }> }) {
  const s = config[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.color}`}>
      {s.label}
    </span>
  );
}

function CardEntregaAdmin({
  pedido,
  entregadores,
}: {
  pedido: PedidoEntrega;
  entregadores: Entregador[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const despacho = pedido.despacho_entrega[0] ?? null;
  const entregadorAtual = despacho
    ? entregadores.find((e) => e.id === despacho.entregador_id)
    : null;

  const atribuirEntregador = useMutation({
    mutationFn: async (entregadorId: string) => {
      if (despacho) {
        const { error } = await externalSupabase
          .from("despacho_entrega")
          .update({ entregador_id: entregadorId })
          .eq("id", despacho.id);
        if (error) throw error;
      } else {
        const { error } = await externalSupabase.from("despacho_entrega").insert({
          pedido_id: pedido.id,
          entregador_id: entregadorId,
          status_entrega: "despachado",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Entregador atribuído" });
      qc.invalidateQueries({ queryKey: ["entregas-admin"] });
    },
    onError: () => toast({ title: "Erro ao atribuir", variant: "destructive" }),
  });

  const atualizarStatus = useMutation({
    mutationFn: async (novoStatus: string) => {
      const { error } = await externalSupabase
        .from("pedidos")
        .update({ status: novoStatus })
        .eq("id", pedido.id);
      if (error) throw error;
      if (novoStatus === "entregue" && despacho) {
        await externalSupabase
          .from("despacho_entrega")
          .update({ status_entrega: "entregue", entregue_em: new Date().toISOString() })
          .eq("id", despacho.id);
      }
    },
    onSuccess: () => {
      toast({ title: "Status atualizado" });
      qc.invalidateQueries({ queryKey: ["entregas-admin"] });
    },
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  const proximos = PROXIMOS_STATUS[pedido.status] ?? [];
  const nomeCliente = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
  const telefone = pedido.clientes?.telefone ?? "";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-secondary/50 transition-colors"
      >
        <div className="bg-primary/10 p-1.5 rounded-lg shrink-0">
          <Package className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{nomeCliente}</span>
            <StatusBadge status={pedido.status} config={STATUS_CONFIG} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {pedido.endereco ?? "Endereço não informado"}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {pedido.valor_total && (
            <span className="text-sm font-semibold text-foreground hidden sm:block">
              R$ {pedido.valor_total.toFixed(2)}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
          {/* Itens */}
          {pedido.itens_pedido.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Itens</p>
              <ul className="text-sm space-y-0.5">
                {pedido.itens_pedido.map((item, i) => (
                  <li key={i}>×{item.quantidade} {item.item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {telefone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-3.5 h-3.5" />
                <a href={`https://wa.me/${telefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="hover:text-primary">
                  {telefone}
                </a>
              </div>
            )}
            {pedido.endereco && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />
                <span className="truncate">{pedido.endereco}</span>
              </div>
            )}
            {pedido.pagamento && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-xs">Pagamento: {pedido.pagamento}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {format(new Date(pedido.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
            </div>
          </div>

          {/* Entregador */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
              <Truck className="w-4 h-4" />
              <span>Entregador:</span>
            </div>
            <Select
              value={entregadorAtual?.id ?? ""}
              onValueChange={(v) => atribuirEntregador.mutate(v)}
              disabled={atribuirEntregador.isPending}
            >
              <SelectTrigger className="h-8 text-sm flex-1">
                <SelectValue placeholder="Atribuir..." />
              </SelectTrigger>
              <SelectContent>
                {entregadores.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ações de status */}
          {proximos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {proximos.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "cancelado" ? "destructive" : "default"}
                  disabled={atualizarStatus.isPending}
                  onClick={() => atualizarStatus.mutate(s)}
                >
                  {atualizarStatus.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  {STATUS_CONFIG[s]?.label ?? s}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CardEntregaEntregador({ pedido }: { pedido: PedidoEntrega }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { entregadorId } = useAuth();

  const despacho = pedido.despacho_entrega.find((d) => d.entregador_id === entregadorId);
  const nomeCliente = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
  const telefone = pedido.clientes?.telefone ?? "";

  const marcarEntregue = useMutation({
    mutationFn: async () => {
      const { error } = await externalSupabase
        .from("pedidos")
        .update({ status: "entregue" })
        .eq("id", pedido.id);
      if (error) throw error;
      if (despacho) {
        await externalSupabase
          .from("despacho_entrega")
          .update({ status_entrega: "entregue", entregue_em: new Date().toISOString() })
          .eq("id", despacho.id);
      }
    },
    onSuccess: () => {
      toast({ title: "Marcado como entregue!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{nomeCliente}</span>
          </div>
          {telefone && (
            <a
              href={`https://wa.me/${telefone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary mt-1"
            >
              <Phone className="w-3 h-3" /> {telefone}
            </a>
          )}
        </div>
        {pedido.valor_total && (
          <span className="text-sm font-semibold text-foreground shrink-0">
            R$ {pedido.valor_total.toFixed(2)}
          </span>
        )}
      </div>

      {pedido.endereco && (
        <div className="flex items-center gap-1.5 text-sm text-foreground bg-secondary rounded-lg px-3 py-2">
          <MapPin className="w-4 h-4 text-primary shrink-0" />
          <span>{pedido.endereco}</span>
        </div>
      )}

      {pedido.itens_pedido.length > 0 && (
        <ul className="text-sm text-muted-foreground space-y-0.5">
          {pedido.itens_pedido.map((item, i) => (
            <li key={i}>×{item.quantidade} {item.item}</li>
          ))}
        </ul>
      )}

      {pedido.pagamento && (
        <p className="text-xs text-muted-foreground">Pagamento: {pedido.pagamento}</p>
      )}

      <Button
        className="w-full"
        onClick={() => marcarEntregue.mutate()}
        disabled={marcarEntregue.isPending || pedido.status === "entregue"}
      >
        {marcarEntregue.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Atualizando...</>
        ) : pedido.status === "entregue" ? (
          <><CheckCircle className="w-4 h-4 mr-2" />Entregue</>
        ) : (
          <><CheckCircle className="w-4 h-4 mr-2" />Marcar como entregue</>
        )}
      </Button>
    </div>
  );
}

export default function Entregas() {
  const { role, entregadorId, entregadorNome } = useAuth();

  const { data: pedidos, isLoading } = useQuery({
    queryKey: role === "admin" ? ["entregas-admin"] : ["entregas-entregador", entregadorId],
    queryFn: role === "admin"
      ? fetchEntregasAdmin
      : () => fetchEntregasEntregador(entregadorId!),
    enabled: role === "admin" || !!entregadorId,
    refetchInterval: 30_000,
  });

  const { data: entregadores } = useQuery({
    queryKey: ["entregadores"],
    queryFn: fetchEntregadores,
    enabled: role === "admin",
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const emAndamento = pedidos?.filter((p) => p.status !== "entregue") ?? [];
  const finalizados = pedidos?.filter((p) => p.status === "entregue") ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Entregas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {role === "entregador"
              ? `Olá, ${entregadorNome} — ${emAndamento.length} entrega(s) pendente(s)`
              : `${emAndamento.length} entrega(s) em andamento`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>Atualiza a cada 30s</span>
        </div>
      </div>

      {pedidos?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma entrega no momento.</p>
        </div>
      ) : (
        <>
          {/* Em andamento */}
          {emAndamento.length > 0 && (
            <div className="space-y-3 mb-6">
              {role === "admin"
                ? emAndamento.map((p) => (
                    <CardEntregaAdmin key={p.id} pedido={p} entregadores={entregadores ?? []} />
                  ))
                : emAndamento.map((p) => (
                    <CardEntregaEntregador key={p.id} pedido={p} />
                  ))}
            </div>
          )}

          {/* Finalizadas hoje */}
          {finalizados.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Entregues</p>
              <div className="space-y-2">
                {finalizados.map((p) => (
                  <div key={p.id} className="bg-secondary rounded-xl px-4 py-2.5 flex items-center gap-3 opacity-60">
                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground truncate">
                        {p.clientes?.nome ?? p.clientes?.telefone ?? "—"}
                      </span>
                      {p.endereco && (
                        <p className="text-xs text-muted-foreground truncate">{p.endereco}</p>
                      )}
                    </div>
                    {p.valor_total && (
                      <span className="text-sm font-medium text-foreground shrink-0">
                        R$ {p.valor_total.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
