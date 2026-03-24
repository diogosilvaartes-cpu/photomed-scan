import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, User, Phone, MapPin, ShoppingBag, MessageSquare, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  novo: { label: "Novo", color: "bg-blue-100 text-blue-700" },
  confirmado: { label: "Confirmado", color: "bg-indigo-100 text-indigo-700" },
  aguardando_balcao: { label: "Aguard. balcão", color: "bg-yellow-100 text-yellow-700" },
  em_separacao: { label: "Em separação", color: "bg-orange-100 text-orange-700" },
  aguardando_pagamento: { label: "Aguard. pagto", color: "bg-yellow-100 text-yellow-700" },
  pago: { label: "Pago", color: "bg-green-100 text-green-700" },
  saiu_para_entrega: { label: "Saiu p/ entrega", color: "bg-purple-100 text-purple-700" },
  pronto_para_retirada: { label: "Pronto retirada", color: "bg-teal-100 text-teal-700" },
  entregue: { label: "Entregue", color: "bg-green-100 text-green-700" },
  retirado: { label: "Retirado", color: "bg-green-100 text-green-700" },
  cancelado: { label: "Cancelado", color: "bg-red-100 text-red-700" },
};

type Cliente = {
  id: string;
  nome: string | null;
  telefone: string;
  endereco: string | null;
  observacoes: string | null;
  created_at: string;
};

type Pedido = {
  id: string;
  resumo: string | null;
  status: string;
  tipo_fulfillment: string;
  valor_total: number | null;
  pagamento: string | null;
  created_at: string;
  itens_pedido: { item: string; quantidade: number; observacao: string | null }[];
};

async function fetchClientes(search: string): Promise<Cliente[]> {
  let query = externalSupabase
    .from("clientes")
    .select("*")
    .order("updated_at", { ascending: false });

  if (search.trim()) {
    query = query.or(`nome.ilike.%${search}%,telefone.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(100);
  if (error) throw error;
  return data ?? [];
}

async function fetchPedidosCliente(clienteId: string): Promise<Pedido[]> {
  const { data, error } = await externalSupabase
    .from("pedidos")
    .select("*, itens_pedido(*)")
    .eq("cliente_id", clienteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Pedido[];
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}

function ClienteDrawer({
  cliente,
  open,
  onClose,
}: {
  cliente: Cliente | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [obs, setObs] = useState(cliente?.observacoes ?? "");

  const { data: pedidos, isLoading: loadingPedidos } = useQuery({
    queryKey: ["pedidos-cliente", cliente?.id],
    queryFn: () => fetchPedidosCliente(cliente!.id),
    enabled: !!cliente?.id && open,
  });

  const updateObs = useMutation({
    mutationFn: async (observacoes: string) => {
      const { error } = await externalSupabase
        .from("clientes")
        .update({ observacoes })
        .eq("id", cliente!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Observações salvas" });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  if (!cliente) return null;

  const nomeDisplay = cliente.nome ?? cliente.telefone;
  const totalGasto = pedidos
    ?.filter((p) => !["cancelado"].includes(p.status))
    .reduce((sum, p) => sum + (p.valor_total ?? 0), 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-xl">
              <User className="w-5 h-5 text-primary" />
            </div>
            <span>{nomeDisplay}</span>
          </SheetTitle>
        </SheetHeader>

        {/* Contato */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="w-4 h-4 shrink-0" />
            <span>{cliente.telefone}</span>
          </div>
          {cliente.endereco && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0" />
              <span>{cliente.endereco}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShoppingBag className="w-4 h-4 shrink-0" />
            <span>{pedidos?.length ?? 0} pedido(s) · R$ {totalGasto.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Cliente desde {format(new Date(cliente.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Observações */}
        <div className="space-y-2 mb-6">
          <Label className="text-label">Observações internas</Label>
          <Textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Preferências, alergias, notas..."
            rows={3}
            className="resize-none"
          />
          <Button
            size="sm"
            onClick={() => updateObs.mutate(obs)}
            disabled={updateObs.isPending}
          >
            {updateObs.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            Salvar
          </Button>
        </div>

        <Separator className="my-4" />

        {/* Histórico de pedidos */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Histórico de pedidos</h3>
          {loadingPedidos ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : pedidos?.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum pedido ainda.</p>
          ) : (
            <div className="space-y-3">
              {pedidos?.map((pedido) => (
                <div key={pedido.id} className="bg-secondary rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={pedido.status} />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(pedido.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  {pedido.itens_pedido.length > 0 && (
                    <ul className="text-sm text-foreground space-y-0.5">
                      {pedido.itens_pedido.map((item, i) => (
                        <li key={i} className="flex items-center gap-1">
                          <span className="text-muted-foreground">×{item.quantidade}</span>
                          <span>{item.item}</span>
                          {item.observacao && (
                            <span className="text-muted-foreground text-xs">({item.observacao})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {pedido.resumo && !pedido.itens_pedido.length && (
                    <p className="text-sm text-foreground">{pedido.resumo}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{pedido.tipo_fulfillment === "entrega" ? "Entrega" : "Retirada"}</span>
                    {pedido.valor_total ? (
                      <span className="font-medium text-foreground">R$ {pedido.valor_total.toFixed(2)}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Clientes() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Simple debounce
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout((window as any).__searchTimeout);
    (window as any).__searchTimeout = setTimeout(() => setDebouncedSearch(value), 300);
  };

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["clientes", debouncedSearch],
    queryFn: () => fetchClientes(debouncedSearch),
  });

  function openCliente(c: Cliente) {
    setSelectedCliente(c);
    setDrawerOpen(true);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {clientes?.length ?? 0} cliente(s) encontrado(s)
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou telefone..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9 input-med"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : clientes?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <User className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum cliente encontrado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clientes?.map((c) => (
            <button
              key={c.id}
              onClick={() => openCliente(c)}
              className="w-full bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-secondary transition-colors text-left"
            >
              <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {c.nome ?? "Sem nome"}
                </p>
                <p className="text-xs text-muted-foreground truncate">{c.telefone}</p>
              </div>
              {c.endereco && (
                <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <MapPin className="w-3 h-3" />
                  <span className="max-w-[160px] truncate">{c.endereco}</span>
                </div>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}

      <ClienteDrawer
        cliente={selectedCliente}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
