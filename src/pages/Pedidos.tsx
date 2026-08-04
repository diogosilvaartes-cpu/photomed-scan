import { useEffect, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import {
  Loader2, RefreshCw, Phone, MapPin, CreditCard, Package, ChevronRight, X, Clock,
  Truck, Navigation, LocateFixed, CheckCircle, Eye, FileText, History, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { STATUS, statusConfig, brl, moneyClass } from "@/lib/status";
import FichaPedido from "@/components/FichaPedido";
import NovoPedidoModal from "@/components/NovoPedidoModal";
import {
  type Pedido, type EntregadorFull,
  PEDIDO_SELECT, formatPhone, formatCurrency, timeAgo, isCoords, mapsLink, pedidoNumero,
} from "@/lib/pedido";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Kanban config ────────────────────────────────────────────────────────────

const COLUNAS = [
  {
    status: "novo",
    label: "Novos",
    Icon: STATUS.novo.Icon,
    bg: "bg-status-novo",
    bgLight: "bg-status-novo/10",
    border: "border-status-novo",
    text: "text-status-ink-novo",
    badge: "bg-status-novo text-white",
    cardAccent: "border-l-status-novo",
    actionBg: "bg-status-novo hover:bg-status-novo/90 text-white",
  },
  {
    status: "em_separacao",
    label: "Separação",
    Icon: STATUS.em_separacao.Icon,
    bg: "bg-status-separacao",
    bgLight: "bg-status-separacao/10",
    border: "border-status-separacao",
    text: "text-status-ink-separacao",
    badge: "bg-status-separacao text-white",
    cardAccent: "border-l-status-separacao",
    actionBg: "bg-status-separacao hover:bg-status-separacao/90 text-white",
  },
  {
    status: "saiu_para_entrega",
    label: "Na rua",
    Icon: STATUS.saiu_para_entrega.Icon,
    bg: "bg-status-rua",
    bgLight: "bg-status-rua/10",
    border: "border-status-rua",
    text: "text-status-ink-rua",
    badge: "bg-status-rua text-white",
    cardAccent: "border-l-status-rua",
    actionBg: "bg-status-rua hover:bg-status-rua/90 text-white",
  },
  {
    status: "entregue",
    label: "Entregue",
    Icon: STATUS.entregue.Icon,
    bg: "bg-status-entregue",
    bgLight: "bg-status-entregue/10",
    border: "border-status-entregue",
    text: "text-status-ink-entregue",
    badge: "bg-status-entregue text-white",
    cardAccent: "border-l-status-entregue",
    actionBg: "",
  },
  {
    status: "cancelado",
    label: "Cancelado",
    Icon: STATUS.cancelado.Icon,
    bg: "bg-status-cancelado",
    bgLight: "bg-status-cancelado/10",
    border: "border-status-cancelado",
    text: "text-status-ink-cancelado",
    badge: "bg-status-cancelado text-white",
    cardAccent: "border-l-status-cancelado",
    actionBg: "",
  },
] as const;

type ColConfig = typeof COLUNAS[number];

const CANCELABLE = ["novo", "em_separacao", "saiu_para_entrega"];

/** Impede que um clique em link/botão dentro do card abra a ficha. */
function pararPropagacao(e: React.MouseEvent) {
  e.stopPropagation();
}

// ─── DespacharModal ───────────────────────────────────────────────────────────

function DespacharModal({
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

      // Atualiza status + valor_total do pedido
      const pedidoUpdate: Record<string, unknown> = { status: "saiu_para_entrega" };
      if (valorTotal && !pedido.valor_total) pedidoUpdate.valor_total = valorTotal;
      const { error: errPedido } = await externalSupabase
        .from("pedidos")
        .update(pedidoUpdate)
        .eq("id", pedido.id);
      if (errPedido) throw new Error(errPedido.message);

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

        // Notifica entregador com lista de itens
        const entregador = entregadores.find((e) => e.id === selectedId);
        const clienteNome = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
        const itensStr = pedido.itens_pedido
          ?.filter((i) => i.item)
          .map((i) => `• ${i.quantidade}x ${i.item}`)
          .join("\n") || "ver pedido";
        const valorStr = valorTotal != null ? formatCurrency(valorTotal) : "—";
        if (entregador?.telefone) {
          try {
            await fetch("/api/notify-client", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phone: entregador.telefone.replace(/\D/g, ""),
                message: `🛵 *ENTREGA PARA VOCÊ*\n👤 ${clienteNome}\n📍 ${pedido.endereco ?? "—"}\n\n📦 *Itens:*\n${itensStr}\n\n💳 ${pedido.pagamento ?? "—"} — ${valorStr}`,
              }),
            });
          } catch { /* notificação silenciosa */ }
        }
        const telefoneCliente = pedido.clientes?.telefone;
        if (telefoneCliente) {
          try {
            await fetch("/api/notify-client", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phone: telefoneCliente.replace(/\D/g, ""),
                message: "🚚 Seu pedido saiu pra entrega!",
              }),
            });
          } catch { /* notificação silenciosa */ }
        }
      }

      toast({ title: "Pedido despachado!" });
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
          <DialogTitle>{despachoExistenteInicial ? "Mudar entregador" : "Despachar pedido"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cliente: <span className="font-medium text-foreground">{pedido.clientes?.nome ?? "—"}</span>
          </p>
          {pedido.endereco && (
            <p className="text-sm text-muted-foreground">
              Endereço: <span className="font-medium text-foreground">{pedido.endereco}</span>
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

// ─── OrderCard ────────────────────────────────────────────────────────────────

function OrderCard({
  p,
  col,
  entregadores,
  onStatusChange,
  onDespachar,
  onAbrirFicha,
  readOnly = false,
}: {
  p: Pedido;
  col: ColConfig;
  entregadores: EntregadorFull[];
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
  onDespachar: (pedido: Pedido) => void;
  onAbrirFicha: (pedido: Pedido) => void;
  readOnly?: boolean;
}) {
  const phone = formatPhone(p.clientes?.telefone ?? null);
  const nome = p.clientes?.nome ?? "Cliente";
  const itens = p.itens_pedido?.filter((i) => i.item && i.item !== "[object Object]") ?? [];
  const despacho = p.despacho_entrega?.[0] ?? null;
  const entregadorNome = despacho?.entregador_id
    ? entregadores.find((e) => e.id === despacho.entregador_id)?.nome ?? null
    : null;
  const enderecoLink = p.endereco ? mapsLink(p.endereco) : null;
  const enderecoIsCoords = p.endereco ? isCoords(p.endereco) : false;

  const [updating, setUpdating] = useState(false);
  const canCancel = p.status ? CANCELABLE.includes(p.status) : false;

  // Para em_separacao e saiu_para_entrega mostramos botões customizados
  const isEmSeparacao = p.status === "em_separacao";
  const isSaiuParaEntrega = p.status === "saiu_para_entrega";
  // Para outros status avançamos normalmente
  const NEXT_NORMAL: Record<string, { status: string; label: string }> = {
    novo: { status: "em_separacao", label: "Iniciar Separação" },
    saiu_para_entrega: { status: "entregue", label: "Confirmar Entrega" },
  };
  const next = p.status ? NEXT_NORMAL[p.status] ?? null : null;

  async function advance(newStatus: string) {
    setUpdating(true);
    await onStatusChange(p.id, newStatus);
    setUpdating(false);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir ficha do pedido de ${nome}`}
      onClick={() => onAbrirFicha(p)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrirFicha(p); }
      }}
      className={cn(
        "group shrink-0 rounded-2xl border-l-4 shadow-md overflow-hidden border border-white/60",
        "cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        col.bgLight, col.cardAccent
      )}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <p className="text-lg font-bold text-foreground leading-tight">{nome}</p>
            <span className="text-[11px] font-mono text-muted-foreground">{pedidoNumero(p)}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-1">
            {p.created_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {timeAgo(p.created_at)}
              </span>
            )}
            <FileText className={cn("w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity", col.text)} />
          </div>
        </div>
        {phone && (
          <a
            href={`https://wa.me/55${phone}`}
            target="_blank"
            rel="noreferrer"
            onClick={pararPropagacao}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80"
          >
            <Phone className="w-4 h-4" />
            {phone}
          </a>
        )}
      </div>

      {/* Itens */}
      {itens.length > 0 && (
        <div className={cn("px-4 py-3 border-t border-b border-border", col.bgLight)}>
          <div className="flex items-start gap-2">
            <Package className={cn("w-4 h-4 mt-0.5 shrink-0", col.text)} />
            <ul className="text-sm text-foreground space-y-0.5">
              {itens.map((i, idx) => (
                <li key={idx}>
                  <span className={cn("font-bold", col.text)}>×{i.quantidade}</span>{" "}{i.item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!itens.length && p.resumo && (
        <div className={cn("px-4 py-3 border-t border-border", col.bgLight)}>
          <p className="text-sm text-muted-foreground italic">{p.resumo}</p>
        </div>
      )}

      {/* Endereço + valor */}
      <div className="px-4 py-3 space-y-2">
        {p.endereco && enderecoLink && (
          <a href={enderecoLink} target="_blank" rel="noreferrer" onClick={pararPropagacao}
            className="flex items-start gap-2 text-sm text-status-ink-novo hover:underline">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{enderecoIsCoords ? "Ver no Maps" : p.endereco}</span>
          </a>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CreditCard className="w-4 h-4" />
            <span>{p.pagamento ?? "—"}</span>
            {p.pix_link && (
              <a href={p.pix_link} target="_blank" rel="noreferrer" onClick={pararPropagacao}
                className="ml-1 text-status-ink-novo text-xs hover:underline font-medium">ver PIX</a>
            )}
          </div>
          {p.valor_total != null && (
            <span className="text-xl font-extrabold text-foreground">{formatCurrency(p.valor_total)}</span>
          )}
        </div>

        {entregadorNome && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
            <Truck className="w-4 h-4 shrink-0" />
            <span>Entregador: <span className="font-medium text-foreground">{entregadorNome}</span></span>
          </div>
        )}
        {despacho?.pagamento_recebido?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="text-xs text-muted-foreground">Recebido:</span>
            {despacho.pagamento_recebido.map((pg, i) => (
              <span key={i} className="text-xs bg-status-entregue/15 text-money px-2 py-0.5 rounded-full font-medium">
                {pg.forma} R$ {pg.valor.toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Ações — escondidas para entregador: a aba dele espelha o balcão, mas é só leitura */}
      {!readOnly && (next || isEmSeparacao || canCancel) && (
        <div className="px-4 pb-4 flex gap-2" onClick={pararPropagacao}>
          {isEmSeparacao && (
            <button
              disabled={updating}
              onClick={() => onDespachar(p)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-bold transition-colors",
                col.actionBg,
                updating && "opacity-60 cursor-not-allowed"
              )}
            >
              <Truck className="w-4 h-4" />Despachar
            </button>
          )}
          {isSaiuParaEntrega && (
            <button
              disabled={updating}
              onClick={() => onDespachar(p)}
              title="Mudar entregador"
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-status-rua/10 text-status-ink-rua hover:bg-status-rua/15 transition-colors shrink-0"
            >
              <Truck className="w-4 h-4" />
            </button>
          )}
          {!isEmSeparacao && next && col.actionBg && (
            <button
              disabled={updating}
              onClick={() => advance(next.status)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-bold transition-colors",
                col.actionBg,
                updating && "opacity-60 cursor-not-allowed"
              )}
            >
              {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ChevronRight className="w-4 h-4" />{next.label}</>}
            </button>
          )}
          {canCancel && (
            <button
              disabled={updating}
              onClick={() => advance("cancelado")}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-status-cancelado/10 text-status-cancelado hover:bg-status-cancelado/15 transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NaRuaCard ────────────────────────────────────────────────────────────────

function NaRuaCard({
  p,
  entregadores,
  onConfirmarEntrega,
  onAbrirFicha,
  readOnly = false,
}: {
  p: Pedido;
  entregadores: EntregadorFull[];
  onConfirmarEntrega: (id: string) => Promise<void>;
  onAbrirFicha: (pedido: Pedido) => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const phone = formatPhone(p.clientes?.telefone ?? null);
  const nome = p.clientes?.nome ?? "Cliente";
  const despacho = p.despacho_entrega?.[0] ?? null;
  const entregador = despacho?.entregador_id
    ? entregadores.find((e) => e.id === despacho.entregador_id)
    : null;
  const enderecoLink = p.endereco ? mapsLink(p.endereco) : null;
  const locLink = despacho?.localizacao ? `https://maps.google.com/?q=${despacho.localizacao}` : null;

  const [confirming, setConfirming] = useState(false);

  async function handleConfirmar() {
    setConfirming(true);
    try {
      await onConfirmarEntrega(p.id);
      toast({ title: "Entrega confirmada!" });
    } catch {
      toast({ title: "Erro ao confirmar", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir ficha do pedido de ${nome}`}
      onClick={() => onAbrirFicha(p)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrirFicha(p); }
      }}
      className="group shrink-0 rounded-2xl border border-status-rua/30 bg-status-rua/10 shadow-md overflow-hidden border-l-4 border-l-violet-500 cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-bold text-foreground">{nome}</p>
            <span className="text-[11px] font-mono text-muted-foreground">{pedidoNumero(p)}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 shrink-0">
            {p.created_at && (
              <span className="text-xs text-muted-foreground">{timeAgo(p.created_at)}</span>
            )}
            <FileText className="w-3.5 h-3.5 text-status-ink-rua opacity-40 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        {phone && (
          <a
            href={`https://wa.me/55${phone}`}
            target="_blank"
            rel="noreferrer"
            onClick={pararPropagacao}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 mt-1"
          >
            <Phone className="w-4 h-4" />{phone}
          </a>
        )}
      </div>

      <div className="px-4 pb-3 space-y-2">
        {/* Entregador */}
        {entregador && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Truck className="w-4 h-4 shrink-0 text-status-rua" />
            <span>{entregador.nome}</span>
            {entregador.telefone && (
              <a
                href={`https://wa.me/${entregador.telefone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                onClick={pararPropagacao}
                className="text-primary hover:text-primary/80"
              >
                <Phone className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Endereço */}
        {p.endereco && (
          <a
            href={enderecoLink ?? "#"}
            target="_blank"
            rel="noreferrer"
            onClick={pararPropagacao}
            className="flex items-start gap-2 text-sm text-status-ink-novo hover:underline"
          >
            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{isCoords(p.endereco) ? "Ver no Maps" : p.endereco}</span>
          </a>
        )}

        {/* Localização GPS */}
        {locLink && (
          <a
            href={locLink}
            target="_blank"
            rel="noreferrer"
            onClick={pararPropagacao}
            className="flex items-center gap-1.5 text-xs text-status-ink-rua hover:underline"
          >
            <LocateFixed className="w-3.5 h-3.5" />GPS atual
          </a>
        )}

        {/* Saiu / Chegou */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {despacho?.saiu_em && (
            <span className="flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5 text-status-rua/70" />
              Saiu às {format(new Date(despacho.saiu_em), "HH:mm", { locale: ptBR })}
            </span>
          )}
          {despacho?.chegou_em ? (
            <span className="flex items-center gap-1 text-status-ink-entregue font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Chegou às {format(new Date(despacho.chegou_em), "HH:mm", { locale: ptBR })}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-status-separacao">
              <Clock className="w-3.5 h-3.5" />A caminho...
            </span>
          )}
        </div>

        {/* Valor + pagamento */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{p.pagamento ?? "—"}</span>
          {p.valor_total != null && (
            <span className="text-xl font-extrabold text-foreground">{formatCurrency(p.valor_total)}</span>
          )}
        </div>

        {/* Pagamento recebido */}
        {despacho?.pagamento_recebido?.length ? (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-muted-foreground">Recebido:</span>
            {despacho.pagamento_recebido.map((pg, i) => (
              <span key={i} className="text-xs bg-status-entregue/15 text-money px-2 py-0.5 rounded-full font-medium">
                {pg.forma} R$ {pg.valor.toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Confirmar entregue — escondido para entregador (aba só leitura) */}
      {!readOnly && (
        <div className="px-4 pb-4" onClick={pararPropagacao}>
          <button
            disabled={confirming}
            onClick={handleConfirmar}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-status-entregue hover:bg-status-entregue text-white text-sm font-bold transition-colors disabled:opacity-60"
          >
            {confirming
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><CheckCircle className="w-4 h-4" />Marcar como entregue</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TODOS_STATUS = COLUNAS.map((c) => c.status);
const STATUS_ATIVOS_DEFAULT = ["novo", "em_separacao", "saiu_para_entrega"];

export default function Pedidos() {
  // O entregador enxerga a mesma fila do balcão, mas sem poder agir nela:
  // baixa de estoque, confirmação e mudança de status continuam só do admin.
  const { role } = useAuth();
  const readOnly = role !== "admin";
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [entregadores, setEntregadores] = useState<EntregadorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtros, setFiltros] = useState<string[]>(STATUS_ATIVOS_DEFAULT);
  const [aba, setAba] = useState<"kanban" | "na_rua" | "historico">("kanban");
  const [despacharPedido, setDespacharPedido] = useState<Pedido | null>(null);
  const [novoPedido, setNovoPedido] = useState(false);
  // Ficha aberta: guardamos só o id para o card seguir vivo nos refreshes de 30s
  const [fichaId, setFichaId] = useState<string | null>(null);

  function toggleFiltro(status: string) {
    setFiltros((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const [{ data: pedidosData }, { data: entregadoresData }] = await Promise.all([
      externalSupabase
        .from("pedidos")
        .select(PEDIDO_SELECT)
        .order("created_at", { ascending: false }),
      externalSupabase.from("entregadores").select("*"),
    ]);
    setPedidos((pedidosData as unknown as Pedido[]) ?? []);
    setEntregadores((entregadoresData as EntregadorFull[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function notifyWhatsApp(phone: string, message: string) {
    try {
      await fetch("/api/notify-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ""), message }),
      });
    } catch { /* notificação silenciosa */ }
  }

  async function handleStatusChange(id: string, newStatus: string) {
    await externalSupabase.from("pedidos").update({ status: newStatus }).eq("id", id);
    setPedidos((prev) => prev.map((p) => (p.id === id ? { ...p, status: newStatus } : p)));

    const pedido = pedidos.find((p) => p.id === id);
  }

  async function handleConfirmarEntrega(id: string) {
    const pedido = pedidos.find((p) => p.id === id);
    const despacho = pedido?.despacho_entrega?.[0];
    await externalSupabase.from("pedidos").update({ status: "entregue" }).eq("id", id);
    if (despacho) {
      await externalSupabase
        .from("despacho_entrega")
        .update({ status_entrega: "entregue", chegou_em: new Date().toISOString() })
        .eq("id", despacho.id);
    }
    setPedidos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "entregue" } : p)));

    const telefoneCliente = pedido?.clientes?.telefone;
    if (telefoneCliente) {
      notifyWhatsApp(telefoneCliente, "✅ Chegou!");
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  const byStatus = (status: string) => pedidos.filter((p) => p.status === status);
  const naRua = pedidos.filter((p) => p.status === "saiu_para_entrega");
  // Cards e ficha usam a lista toda (pedido antigo pode ter entregador já desativado);
  // só o despacho oferece exclusivamente quem está ativo.
  const entregadoresAtivos = entregadores.filter((e) => e.ativo);
  const pedidoFicha = fichaId ? pedidos.find((p) => p.id === fichaId) ?? null : null;

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 bg-background border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-2xl font-extrabold text-foreground">Pedidos</h1>
            {readOnly && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-semibold shrink-0">
                <Eye className="w-3.5 h-3.5" />
                Somente leitura
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            {!readOnly && (
              <button
                onClick={() => setNovoPedido(true)}
                className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Novo pedido</span>
              </button>
            )}
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-1">
          <button
            onClick={() => setAba("kanban")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              aba === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            Kanban
          </button>
          <button
            onClick={() => setAba("na_rua")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              aba === "na_rua" ? "bg-status-rua text-white" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <Truck className="w-4 h-4" />
            Na rua
            {naRua.length > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-xs font-bold",
                aba === "na_rua" ? "bg-white/20 text-white" : "bg-status-rua text-white"
              )}>
                {naRua.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setAba("historico")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              aba === "historico" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <History className="w-4 h-4" />
            Histórico
          </button>
        </div>
      </div>

      {/* ── ABA KANBAN ── */}
      {aba === "kanban" && (
        <>
          {/* Filtros */}
          <div className="px-4 pb-3 pt-3 flex flex-wrap gap-2">
            {COLUNAS.map((col) => (
              <button
                key={col.status}
                onClick={() => toggleFiltro(col.status)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                  filtros.includes(col.status)
                    ? `${col.badge} border-transparent`
                    : "bg-background text-muted-foreground border-border"
                )}>
                <col.Icon className="w-4 h-4 shrink-0" /> {col.label}
                <span className={cn("ml-0.5 font-bold", filtros.includes(col.status) ? "opacity-80" : "")}>
                  {byStatus(col.status).length}
                </span>
              </button>
            ))}
          </div>

          {/* Kanban board */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex gap-4 p-4 items-start min-h-full" style={{ minWidth: "max-content" }}>
              {COLUNAS.filter((col) => filtros.includes(col.status)).map((col) => {
                const items = byStatus(col.status);
                return (
                  <div key={col.status} className="flex-shrink-0 w-72 sm:w-80 flex flex-col gap-3">
                    <div className={cn("flex items-center justify-between px-4 py-2.5 rounded-xl", col.bgLight)}>
                      <span className={cn("font-bold text-base flex items-center gap-1.5", col.text)}><col.Icon className="w-4 h-4 shrink-0" />{col.label}</span>
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", col.badge)}>{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
                      {items.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-10">Nenhum pedido</p>
                      ) : (
                        items.map((p) => (
                          <OrderCard
                            key={p.id}
                            p={p}
                            col={col}
                            entregadores={entregadores}
                            onStatusChange={handleStatusChange}
                            onDespachar={setDespacharPedido}
                            onAbrirFicha={(pedido) => setFichaId(pedido.id)}
                            readOnly={readOnly}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── ABA NA RUA ── */}
      {aba === "na_rua" && (
        <div className="flex-1 overflow-y-auto p-4">
          {naRua.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
              <Truck className="w-10 h-10 opacity-30" />
              <p className="text-sm">Nenhum pedido em trânsito agora</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {naRua.map((p) => (
                <NaRuaCard
                  key={p.id}
                  p={p}
                  entregadores={entregadores}
                  onConfirmarEntrega={handleConfirmarEntrega}
                  onAbrirFicha={(pedido) => setFichaId(pedido.id)}
                  readOnly={readOnly}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ABA HISTÓRICO ── */}
      {/* Veio do Dashboard, que foi removido: a lista corrida de pedidos por data,
          útil para achar um pedido antigo sem depender das colunas do Kanban. */}
      {aba === "historico" && (
        <div className="flex-1 overflow-y-auto p-4">
          {pedidos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
              <History className="w-10 h-10 opacity-30" />
              <p className="text-sm">Nenhum pedido registrado</p>
            </div>
          ) : (
            <div className="space-y-2 max-w-3xl mx-auto">
              {pedidos.map((p) => {
                const cfg = statusConfig(p.status);
                return (
                  <button
                    key={p.id}
                    onClick={() => setFichaId(p.id)}
                    className="w-full text-left bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 shadow-card hover:bg-secondary transition-colors"
                  >
                    <div className={cn("shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center", cfg.pill)}>
                      <cfg.Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {p.clientes?.nome ?? p.clientes?.telefone ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {p.created_at ? format(new Date(p.created_at), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      {p.valor_total != null && (
                        <p className={cn("text-sm", moneyClass(p.valor_total))}>{brl(p.valor_total)}</p>
                      )}
                      <span className={cn("inline-block text-xs px-2 py-0.5 rounded-full border font-semibold", cfg.pill)}>
                        {cfg.plural}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modais */}

      {pedidoFicha && (
        <FichaPedido
          pedido={pedidoFicha}
          entregadores={entregadores}
          open={!!pedidoFicha}
          onClose={() => setFichaId(null)}
        />
      )}

      {novoPedido && !readOnly && (
        <NovoPedidoModal
          open={novoPedido}
          onClose={() => setNovoPedido(false)}
          onDone={() => load(true)}
        />
      )}

      {despacharPedido && !readOnly && (
        <DespacharModal
          pedido={despacharPedido}
          entregadores={entregadoresAtivos}
          open={!!despacharPedido}
          onClose={() => setDespacharPedido(null)}
          onDone={() => load(true)}
        />
      )}
    </div>
  );
}
