import { useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, User, MapPin, Phone, Package, Loader2,
  CheckCircle, Clock, ChevronDown, Navigation, Settings, KeyRound,
  LocateFixed, LogOut
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase, createTempAuthClient, pinToPassword } from "@/integrations/supabase/external-client";
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

type Entregador = { id: string; nome: string; telefone: string; ativo: boolean; user_id: string | null };

type ItemPagamento = { forma: string; valor: number };

type DespachoEntrega = {
  id: string;
  entregador_id: string | null;
  status_entrega: string;
  observacao: string | null;
  enviado_em: string;
  entregue_em: string | null;
  saiu_em: string | null;
  chegou_em: string | null;
  localizacao: string | null;
  pagamento_recebido: ItemPagamento[] | null;
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
  clientes: { nome: string | null; telefone: string; observacoes: string | null; foto_url: string | null } | null;
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
    .eq("entregador_id", entregadorId);
  if (de) throw de;

  const pedidoIds = (despachos ?? []).map((d) => d.pedido_id);
  if (!pedidoIds.length) return [];

  const { data, error } = await externalSupabase
    .from("pedidos")
    .select("*, clientes(nome, telefone, observacoes, foto_url), itens_pedido(item, quantidade), despacho_entrega(*)")
    .in("id", pedidoIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PedidoEntrega[];
}

async function fetchEntregadores(): Promise<Entregador[]> {
  const { data, error } = await externalSupabase
    .from("entregadores")
    .select("id, nome, telefone, ativo, user_id")
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
      // Notificar entregador designado
      const entregador = entregadores.find((e) => e.id === entregadorId);
      if (entregador?.telefone) {
        const clienteNome = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
        try {
          await fetch("/api/notify-client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: entregador.telefone.replace(/\D/g, ""),
              message: `🛵 Nova entrega para você!\nCliente: ${clienteNome}\nEndereço: ${pedido.endereco ?? "—"}\nValor: R$ ${pedido.valor_total?.toFixed(2) ?? "—"}\nAcesse o painel para ver os detalhes.`,
            }),
          });
        } catch { /* notificação silenciosa */ }
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

          {/* Pagamento recebido */}
          {despacho?.pagamento_recebido?.length ? (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs space-y-0.5">
              <p className="font-semibold text-green-800">Pagamento recebido pelo entregador:</p>
              {despacho.pagamento_recebido.map((pg, i) => (
                <p key={i} className="text-green-700">{pg.forma}: R$ {pg.valor.toFixed(2)}</p>
              ))}
              <p className="font-semibold text-green-800 border-t border-green-200 pt-1 mt-1">
                Total: R$ {despacho.pagamento_recebido.reduce((s, pg) => s + pg.valor, 0).toFixed(2)}
                {pedido.valor_total ? ` / R$ ${pedido.valor_total.toFixed(2)} esperado` : ""}
              </p>
            </div>
          ) : null}

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

  const saiu = !!despacho?.saiu_em;
  const chegou = !!despacho?.chegou_em;
  const entregue = pedido.status === "entregue";

  async function notificarCliente(msg: string) {
    if (!telefone) return;
    try {
      await fetch("/api/notify-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telefone.replace(/\D/g, ""), message: msg }),
      });
    } catch { /* notificação silenciosa — não bloqueia o fluxo */ }
  }

  const primeiroNome = nomeCliente.split(" ")[0];

  const sairParaEntrega = useMutation({
    mutationFn: async () => {
      if (!despacho) return;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ saiu_em: new Date().toISOString() })
        .eq("id", despacho.id);
      if (error) throw error;
      await externalSupabase.from("pedidos").update({ status: "saiu_para_entrega" }).eq("id", pedido.id);
      await notificarCliente(
        `Olá, ${primeiroNome}! 🛵 Seu pedido saiu para entrega. Em breve estará com você!`
      );
    },
    onSuccess: () => {
      toast({ title: "Saiu para entrega!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const chegarAoLocal = useMutation({
    mutationFn: async () => {
      if (!despacho) return;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ chegou_em: new Date().toISOString() })
        .eq("id", despacho.id);
      if (error) throw error;
      await notificarCliente(
        `Olá, ${primeiroNome}! 📍 Nosso entregador chegou ao seu endereço. Já vai chamar!`
      );
    },
    onSuccess: () => {
      toast({ title: "Chegada registrada!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagItems, setPagItems] = useState<ItemPagamento[]>([]);
  const [pagForma, setPagForma] = useState("Dinheiro");
  const [pagValor, setPagValor] = useState("");

  useEffect(() => {
    if (pagamentoOpen) {
      setPagItems(despacho?.pagamento_recebido ?? []);
      setPagForma("Dinheiro");
      setPagValor(pedido.valor_total?.toFixed(2) ?? "");
    }
  }, [pagamentoOpen]);

  function addPagItem() {
    const v = parseFloat(pagValor.replace(",", "."));
    if (!v || v <= 0) return;
    setPagItems((p) => [...p, { forma: pagForma, valor: v }]);
    setPagValor("");
  }

  const totalPago = pagItems.reduce((s, i) => s + i.valor, 0);

  const marcarEntregue = useMutation({
    mutationFn: async (pagamentos: ItemPagamento[]) => {
      const { error } = await externalSupabase
        .from("pedidos").update({ status: "entregue" }).eq("id", pedido.id);
      if (error) throw error;
      if (despacho) {
        await externalSupabase
          .from("despacho_entrega")
          .update({
            status_entrega: "entregue",
            entregue_em: new Date().toISOString(),
            pagamento_recebido: pagamentos.length ? pagamentos : null,
          })
          .eq("id", despacho.id);
      }
      await notificarCliente(
        `Olá, ${primeiroNome}! ✅ Pedido entregue com sucesso! Obrigado por comprar na Farmácia Vital. 💚`
      );
    },
    onSuccess: () => {
      toast({ title: "Entrega confirmada!" });
      setPagamentoOpen(false);
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const compartilharLocalizacao = useMutation({
    mutationFn: async () => {
      if (!despacho) throw new Error("Sem despacho");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const localizacao = `${pos.coords.latitude},${pos.coords.longitude}`;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ localizacao })
        .eq("id", despacho.id);
      if (error) throw error;
      return localizacao;
    },
    onSuccess: (loc) => {
      toast({ title: "Localização salva!", description: loc });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erro";
      toast({ title: "Não foi possível obter localização", description: msg, variant: "destructive" });
    },
  });

  const mapsUrl = pedido.endereco
    ? /^-?\d+\.\d+,-?\d+\.\d+$/.test(pedido.endereco.trim())
      ? `https://maps.google.com/?q=${pedido.endereco}`
      : `https://maps.google.com/?q=${encodeURIComponent(pedido.endereco)}`
    : null;
  const wppUrl = telefone ? `https://wa.me/${telefone.replace(/\D/g, "")}` : null;
  const locMapsUrl = despacho?.localizacao
    ? `https://maps.google.com/?q=${despacho.localizacao}`
    : null;

  // Busca imagens dos produtos no estoque
  const itemNomes = pedido.itens_pedido.map((i) => i.item);
  const { data: estoqueImgs } = useQuery({
    queryKey: ["estoque-imgs", pedido.id],
    queryFn: async () => {
      if (!itemNomes.length) return {};
      const { data } = await externalSupabase
        .from("estoque").select("nome, imagem_url").in("nome", itemNomes);
      return Object.fromEntries((data ?? []).filter(e => e.imagem_url).map(e => [e.nome, e.imagem_url]));
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">

      {/* Header cliente */}
      <div className="flex items-center gap-3">
        {pedido.clientes?.foto_url ? (
          <img src={pedido.clientes.foto_url} alt={nomeCliente}
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-border" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-primary" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{nomeCliente}</p>
          {pedido.pagamento && (
            <p className="text-xs text-muted-foreground">Pagamento: {pedido.pagamento}</p>
          )}
        </div>
        {/* A receber em destaque */}
        {pedido.valor_total != null && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">A receber</p>
            <p className="text-lg font-bold text-green-600">R$ {pedido.valor_total.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Observações do cliente */}
      {pedido.clientes?.observacoes && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <span className="shrink-0 font-semibold">⚠ Obs:</span>
          <span>{pedido.clientes.observacoes}</span>
        </div>
      )}

      {/* Endereço */}
      {pedido.endereco && (
        <div className="flex items-start gap-2 bg-secondary rounded-lg px-3 py-2">
          <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{pedido.endereco}</span>
        </div>
      )}

      {/* Resumo completo */}
      <div className="bg-secondary rounded-xl p-3 space-y-2">
        {pedido.itens_pedido.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Itens</p>
            <ul className="space-y-2">
              {pedido.itens_pedido.map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  {estoqueImgs?.[item.item] ? (
                    <img src={estoqueImgs[item.item]} alt={item.item}
                      className="w-10 h-10 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="flex-1 text-sm">{item.item}</span>
                  <span className="text-sm font-semibold text-muted-foreground">×{item.quantidade}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="border-t border-border pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {pedido.valor_total != null && (
            <div><span className="text-muted-foreground">Total: </span><span className="font-semibold">R$ {pedido.valor_total.toFixed(2)}</span></div>
          )}
          {pedido.pagamento && (
            <div><span className="text-muted-foreground">Pgto: </span><span className="font-medium">{pedido.pagamento}</span></div>
          )}
          {pedido.pessoa_recebimento && (
            <div className="col-span-2"><span className="text-muted-foreground">Recebedor: </span><span className="font-medium">{pedido.pessoa_recebimento}</span></div>
          )}
        </div>
        {pedido.resumo && (
          <div className="border-t border-border pt-2 text-xs text-muted-foreground">{pedido.resumo}</div>
        )}
      </div>

      {/* Links rápidos + CRM */}
      <div className="flex gap-2">
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors border border-blue-200">
            <Navigation className="w-4 h-4" /> Maps
          </a>
        )}
        {wppUrl && (
          <a href={wppUrl} target="_blank" rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100 transition-colors border border-green-200">
            <Phone className="w-4 h-4" /> WhatsApp
          </a>
        )}
        <a href={`/clientes?id=${pedido.cliente_id}`}
          className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors border border-border">
          <User className="w-4 h-4" /> CRM
        </a>
      </div>

      {/* Localização registrada */}
      {despacho?.localizacao && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2">
          <LocateFixed className="w-3.5 h-3.5 text-green-600 shrink-0" />
          <span className="flex-1">Localização registrada</span>
          {locMapsUrl && (
            <a href={locMapsUrl} target="_blank" rel="noreferrer" className="text-primary font-medium">Ver</a>
          )}
        </div>
      )}

      {/* Botões de ação */}
      <div className="space-y-2">
        {!entregue && !saiu && (
          <Button className="w-full" variant="outline"
            onClick={() => sairParaEntrega.mutate()}
            disabled={sairParaEntrega.isPending}>
            {sairParaEntrega.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
            Sair para entrega
          </Button>
        )}

        {!chegou && !entregue && (
          <Button className="w-full" variant="outline"
            onClick={() => chegarAoLocal.mutate()}
            disabled={chegarAoLocal.isPending}>
            {chegarAoLocal.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
            Cheguei ao local
          </Button>
        )}

        {!entregue && (
          <Button className="w-full" variant="outline"
            onClick={() => compartilharLocalizacao.mutate()}
            disabled={compartilharLocalizacao.isPending}>
            {compartilharLocalizacao.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LocateFixed className="w-4 h-4 mr-2" />}
            {despacho?.localizacao ? "Atualizar localização" : "Compartilhar localização"}
          </Button>
        )}

        <Button className="w-full"
          onClick={() => !entregue && setPagamentoOpen(true)}
          disabled={marcarEntregue.isPending || entregue}>
          {entregue
            ? <><CheckCircle className="w-4 h-4 mr-2" />Entregue</>
            : <><CheckCircle className="w-4 h-4 mr-2" />Marcar como entregue</>}
        </Button>
      </div>

      {/* Pagamento recebido registrado */}
      {entregue && despacho?.pagamento_recebido?.length ? (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs space-y-0.5">
          <p className="font-semibold text-green-800">Pagamento recebido:</p>
          {despacho.pagamento_recebido.map((p, i) => (
            <p key={i} className="text-green-700">{p.forma}: R$ {p.valor.toFixed(2)}</p>
          ))}
        </div>
      ) : null}

      {/* Modal de pagamento */}
      <Dialog open={pagamentoOpen} onOpenChange={setPagamentoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {pedido.valor_total != null && (
              <div className="flex justify-between items-center bg-secondary rounded-xl px-4 py-3">
                <span className="text-sm text-muted-foreground">Valor esperado</span>
                <span className="text-lg font-bold text-foreground">R$ {pedido.valor_total.toFixed(2)}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Adicionar pagamento</Label>
              <div className="flex gap-2">
                <select
                  value={pagForma}
                  onChange={(e) => setPagForma(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1">
                  {["Dinheiro", "Pix", "Cartão Débito", "Cartão Crédito", "Outro"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <Input
                  type="number" step="0.01" min="0"
                  placeholder="0,00"
                  value={pagValor}
                  onChange={(e) => setPagValor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPagItem()}
                  className="w-28" />
                <Button type="button" size="sm" variant="outline" onClick={addPagItem}>+</Button>
              </div>
            </div>
            {pagItems.length > 0 && (
              <div className="space-y-1">
                {pagItems.map((p, i) => (
                  <div key={i} className="flex justify-between items-center text-sm bg-secondary rounded-lg px-3 py-1.5">
                    <span>{p.forma}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">R$ {p.valor.toFixed(2)}</span>
                      <button onClick={() => setPagItems((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold px-3 pt-1">
                  <span>Total recebido</span>
                  <span className={totalPago >= (pedido.valor_total ?? 0) ? "text-green-600" : "text-amber-600"}>
                    R$ {totalPago.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagamentoOpen(false)}>Cancelar</Button>
            <Button onClick={() => marcarEntregue.mutate(pagItems)} disabled={marcarEntregue.isPending}>
              {marcarEntregue.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Confirmar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ModalView = "list" | "pin" | "novo";

function PinInput({ pin, setPin, pinRefs }: {
  pin: string[];
  setPin: (p: string[]) => void;
  pinRefs: React.RefObject<HTMLInputElement>[];
}) {
  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...pin]; next[index] = digit; setPin(next);
    if (digit && index < 3) pinRefs[index + 1].current?.focus();
  }
  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !pin[index] && index > 0) pinRefs[index - 1].current?.focus();
  }
  return (
    <div className="flex gap-3 justify-center">
      {pin.map((digit, i) => (
        <input key={i} ref={pinRefs[i]} type="number" inputMode="numeric" min={0} max={9}
          value={digit} onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      ))}
    </div>
  );
}

function EntregadoresModal({ open, onClose, entregadores }: {
  open: boolean; onClose: () => void; entregadores: Entregador[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<ModalView>("list");
  const [ativo, setAtivo] = useState<Entregador | null>(null);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  // Novo entregador
  const [novoNome, setNovoNome] = useState("");
  const [novoTel, setNovoTel] = useState("");
  const [novoPin, setNovoPin] = useState(["", "", "", ""]);

  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const novoPinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  function resetAndClose() { onClose(); setView("list"); setAtivo(null); }

  function abrirPin(e: Entregador) {
    setAtivo(e); setPin(["", "", "", ""]); setView("pin");
    setTimeout(() => pinRefs[0].current?.focus(), 100);
  }

  async function salvarLogin() {
    if (!ativo) return;
    const pinStr = pin.join("");
    if (pinStr.length < 4) { toast({ title: "PIN incompleto", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const email = `${ativo.telefone.replace(/\D/g, "")}@farmaciavital.internal`;
      const res = await fetch("/api/create-entregador", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pinToPassword(pinStr), ...(ativo.user_id ? { userId: ativo.user_id } : {}) }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.msg ?? result.error ?? "Erro na API");
      if (!ativo.user_id) {
        if (!result.id) throw new Error("user_id não retornado.");
        const { error } = await externalSupabase.from("entregadores").update({ user_id: result.id }).eq("id", ativo.id);
        if (error) throw new Error(error.message);
      }
      toast({ title: ativo.user_id ? `PIN redefinido para ${ativo.nome}!` : `Login criado para ${ativo.nome}!` });
      qc.invalidateQueries({ queryKey: ["entregadores"] });
      setView("list"); setAtivo(null);
    } catch (err: unknown) {
      toast({ title: "Erro ao salvar login", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally { setLoading(false); }
  }

  async function cadastrarEntregador() {
    if (!novoNome.trim() || !novoTel.trim()) {
      toast({ title: "Nome e telefone são obrigatórios", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const tel = novoTel.replace(/\D/g, "");
      const { data: inserted, error } = await externalSupabase
        .from("entregadores").insert({ nome: novoNome.trim(), telefone: tel, ativo: true }).select().single();
      if (error) throw new Error(error.message);

      const pinStr = novoPin.join("");
      if (pinStr.length === 4 && inserted) {
        const email = `${tel}@farmaciavital.internal`;
        const res = await fetch("/api/create-entregador", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: pinToPassword(pinStr) }),
        });
        const result = await res.json();
        if (res.ok && result.id) {
          await externalSupabase.from("entregadores").update({ user_id: result.id }).eq("id", inserted.id);
        }
      }

      toast({ title: `${novoNome} cadastrado!` });
      qc.invalidateQueries({ queryKey: ["entregadores"] });
      setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]);
      setView("list");
    } catch (err: unknown) {
      toast({ title: "Erro ao cadastrar", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {view === "novo" ? "Novo entregador" : view === "pin" ? (ativo?.user_id ? "Redefinir PIN" : "Criar login") : "Entregadores"}
          </DialogTitle>
        </DialogHeader>

        {view === "list" && (
          <div className="space-y-2">
            {entregadores.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum entregador cadastrado.</p>
            )}
            {entregadores.map((e) => (
              <div key={e.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-secondary/40">
                <div>
                  <p className="text-sm font-medium">{e.nome}</p>
                  <p className="text-xs text-muted-foreground">{e.telefone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {e.user_id
                    ? <><span className="text-xs text-green-600 font-medium">● Ativo</span>
                        <Button size="sm" variant="ghost" onClick={() => abrirPin(e)} title="Redefinir PIN"><KeyRound className="w-3.5 h-3.5" /></Button></>
                    : <Button size="sm" variant="outline" onClick={() => abrirPin(e)}>Criar login</Button>}
                </div>
              </div>
            ))}
            <Button className="w-full mt-2" onClick={() => { setNovoNome(""); setNovoTel(""); setNovoPin(["","","",""]); setView("novo"); }}>
              + Novo entregador
            </Button>
          </div>
        )}

        {view === "pin" && ativo && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">{ativo.nome}</p>
              <p className="text-xs text-muted-foreground">{ativo.telefone}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{ativo.user_id ? "Novo PIN de 4 dígitos" : "Defina um PIN de 4 dígitos"}</p>
              <PinInput pin={pin} setPin={setPin} pinRefs={pinRefs} />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setView("list")}>Voltar</Button>
              <Button className="flex-1" onClick={salvarLogin} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        )}

        {view === "novo" && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="novo-nome">Nome</Label>
                <Input id="novo-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome completo" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="novo-tel">Telefone (WhatsApp)</Label>
                <Input id="novo-tel" value={novoTel} onChange={(e) => setNovoTel(e.target.value)} placeholder="5521900000000" type="tel" />
              </div>
              <div className="space-y-1.5">
                <Label>PIN de acesso (opcional)</Label>
                <PinInput pin={novoPin} setPin={setNovoPin} pinRefs={novoPinRefs} />
                <p className="text-xs text-muted-foreground text-center">Pode ser definido depois</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setView("list")}>Voltar</Button>
              <Button className="flex-1" onClick={cadastrarEntregador} disabled={loading || !novoNome.trim() || !novoTel.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cadastrar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Entregas() {
  const { role, entregadorId, entregadorNome } = useAuth();
  const [entregadoresOpen, setEntregadoresOpen] = useState(false);

  const { data: pedidos, isLoading } = useQuery({
    queryKey: role === "admin" ? ["entregas-admin"] : ["entregas-entregador", entregadorId],
    queryFn: role === "admin"
      ? fetchEntregasAdmin
      : () => fetchEntregasEntregador(entregadorId!),
    enabled: role !== "admin" && (!!entregadorId),
    refetchInterval: 30_000,
  });

  const { data: entregadores } = useQuery({
    queryKey: ["entregadores"],
    queryFn: fetchEntregadores,
    enabled: role === "admin",
  });

  const entregadoresAtivos = (entregadores ?? []).filter((e) => e.ativo);

  // Admin vai para Pedidos (após todos os hooks)
  if (role === "admin") return <Navigate to="/pedidos" replace />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const emAndamento = pedidos?.filter((p) => p.status !== "entregue") ?? [];
  const finalizados = pedidos?.filter((p) => p.status === "entregue") ?? [];

  // Agrupa por data de criação
  function groupByDate(list: PedidoEntrega[]) {
    const groups: Record<string, PedidoEntrega[]> = {};
    list.forEach((p) => {
      const key = format(new Date(p.created_at), "EEEE, dd/MM/yyyy", { locale: ptBR });
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return Object.entries(groups);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Entregas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {role === "entregador"
              ? `Olá, ${entregadorNome} — ${emAndamento.length} entrega(s) pendente(s)`
              : `${emAndamento.length} entrega(s) em andamento`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === "admin" && (
            <Button size="sm" variant="outline" onClick={() => setEntregadoresOpen(true)}>
              <Settings className="w-4 h-4 mr-1.5" />
              Entregadores
            </Button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" /><span>30s</span>
          </div>
        </div>
      </div>

      {role === "admin" && entregadores && (
        <EntregadoresModal
          open={entregadoresOpen}
          onClose={() => setEntregadoresOpen(false)}
          entregadores={entregadores}
        />
      )}

      {pedidos?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma entrega no momento.</p>
        </div>
      ) : (
        <>
          {/* Em andamento — agrupado por data */}
          {emAndamento.length > 0 && (
            <div className="mb-6">
              {groupByDate(emAndamento).map(([date, items]) => (
                <div key={date} className="mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 capitalize">{date}</p>
                  <div className="space-y-3">
                    {role === "admin"
                      ? items.map((p) => <CardEntregaAdmin key={p.id} pedido={p} entregadores={entregadoresAtivos} />)
                      : items.map((p) => <CardEntregaEntregador key={p.id} pedido={p} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Finalizadas */}
          {finalizados.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Entregues</p>
              <div className="space-y-3 opacity-75">
                {role === "admin"
                  ? finalizados.map((p) => <CardEntregaAdmin key={p.id} pedido={p} entregadores={entregadoresAtivos} />)
                  : finalizados.map((p) => <CardEntregaEntregador key={p.id} pedido={p} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
