import { useEffect, useState, useRef } from "react";
import { externalSupabase, pinToPassword } from "@/integrations/supabase/external-client";
import {
  Loader2, RefreshCw, Phone, MapPin, CreditCard, Package, ChevronRight, X, Clock,
  Truck, Settings, KeyRound, Navigation, LocateFixed, CheckCircle, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Item { item: string; quantidade: number; }
interface ItemPagamento { forma: string; valor: number; }

interface Despacho {
  id: string;
  entregador_id: string | null;
  pagamento_recebido: ItemPagamento[] | null;
  saiu_em: string | null;
  chegou_em: string | null;
  localizacao: string | null;
  status_entrega: string;
}

interface Pedido {
  id: string;
  status: string | null;
  resumo: string | null;
  tipo_fulfillment: string | null;
  endereco: string | null;
  pagamento: string | null;
  valor_total: number | null;
  pix_link: string | null;
  created_at: string | null;
  clientes: { nome: string | null; telefone: string | null } | null;
  itens_pedido: Item[];
  despacho_entrega: Despacho[];
}

interface EntregadorFull {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
  user_id: string | null;
}

// ─── Kanban config ────────────────────────────────────────────────────────────

const COLUNAS = [
  {
    status: "novo",
    label: "Novos",
    emoji: "🆕",
    bg: "bg-blue-600",
    bgLight: "bg-blue-50",
    border: "border-blue-500",
    text: "text-blue-700",
    badge: "bg-blue-600 text-white",
    cardAccent: "border-l-blue-500",
    actionBg: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  {
    status: "em_separacao",
    label: "Separação",
    emoji: "📦",
    bg: "bg-amber-500",
    bgLight: "bg-amber-50",
    border: "border-amber-500",
    text: "text-amber-700",
    badge: "bg-amber-500 text-white",
    cardAccent: "border-l-amber-500",
    actionBg: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  {
    status: "saiu_para_entrega",
    label: "Na rua",
    emoji: "🛵",
    bg: "bg-violet-600",
    bgLight: "bg-violet-50",
    border: "border-violet-500",
    text: "text-violet-700",
    badge: "bg-violet-600 text-white",
    cardAccent: "border-l-violet-500",
    actionBg: "bg-violet-600 hover:bg-violet-700 text-white",
  },
  {
    status: "entregue",
    label: "Entregue",
    emoji: "✅",
    bg: "bg-emerald-600",
    bgLight: "bg-emerald-50",
    border: "border-emerald-500",
    text: "text-emerald-700",
    badge: "bg-emerald-600 text-white",
    cardAccent: "border-l-emerald-500",
    actionBg: "",
  },
  {
    status: "cancelado",
    label: "Cancelado",
    emoji: "❌",
    bg: "bg-red-500",
    bgLight: "bg-red-50",
    border: "border-red-400",
    text: "text-red-700",
    badge: "bg-red-500 text-white",
    cardAccent: "border-l-red-400",
    actionBg: "",
  },
] as const;

type ColConfig = typeof COLUNAS[number];

const CANCELABLE = ["novo", "em_separacao", "saiu_para_entrega"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(tel: string | null) {
  if (!tel) return null;
  return tel.replace(/\D/g, "").replace(/^55/, "");
}

function formatCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function isCoords(str: string) {
  return /^-?\d+\.\d+,-?\d+\.\d+$/.test(str.trim());
}

function mapsLink(endereco: string) {
  return isCoords(endereco)
    ? `https://maps.google.com/?q=${endereco}`
    : `https://maps.google.com/?q=${encodeURIComponent(endereco)}`;
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
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function confirmar() {
    setLoading(true);
    try {
      // Atualiza status do pedido
      const { error: errPedido } = await externalSupabase
        .from("pedidos")
        .update({ status: "saiu_para_entrega" })
        .eq("id", pedido.id);
      if (errPedido) throw new Error(errPedido.message);

      if (selectedId) {
        const despachoExistente = pedido.despacho_entrega?.[0];
        if (despachoExistente) {
          await externalSupabase
            .from("despacho_entrega")
            .update({ entregador_id: selectedId, saiu_em: new Date().toISOString(), status_entrega: "despachado" })
            .eq("id", despachoExistente.id);
        } else {
          await externalSupabase.from("despacho_entrega").insert({
            pedido_id: pedido.id,
            entregador_id: selectedId,
            saiu_em: new Date().toISOString(),
            status_entrega: "despachado",
          });
        }

        // Notifica entregador e cliente via WhatsApp
        const entregador = entregadores.find((e) => e.id === selectedId);
        const clienteNome = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
        if (entregador?.telefone) {
          try {
            await fetch("/api/notify-client", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phone: entregador.telefone.replace(/\D/g, ""),
                message: `🛵 *ENTREGA PARA VOCÊ*\n👤 ${clienteNome}\n📍 ${pedido.endereco ?? "—"}\n📦 ${pedido.resumo ?? "ver pedido"}\n💳 ${pedido.valor_total != null ? formatCurrency(pedido.valor_total) : "—"}`,
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
                message: "🚚 Seu pedido saiu para entrega! Em breve chegará até você.",
              }),
            });
          } catch { /* notificação silenciosa */ }
        }
      }

      toast({ title: "Pedido despachado!" });
      onDone();
      onClose();
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
          <DialogTitle>Despachar pedido</DialogTitle>
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
}: {
  p: Pedido;
  col: ColConfig;
  entregadores: EntregadorFull[];
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
  onDespachar: (pedido: Pedido) => void;
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

  // Para em_separacao mostramos o botão "Despachar" customizado
  const isEmSeparacao = p.status === "em_separacao";
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
    <div className={cn("rounded-2xl border-l-4 shadow-md overflow-hidden border border-white/60", col.bgLight, col.cardAccent)}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-lg font-bold text-gray-900 leading-tight">{nome}</p>
          {p.created_at && (
            <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0 mt-1">
              <Clock className="w-3 h-3" />
              {timeAgo(p.created_at)}
            </div>
          )}
        </div>
        {phone && (
          <a
            href={`https://wa.me/55${phone}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-700"
          >
            <Phone className="w-4 h-4" />
            {phone}
          </a>
        )}
      </div>

      {/* Itens */}
      {itens.length > 0 && (
        <div className={cn("px-4 py-3 border-t border-b border-gray-100", col.bgLight)}>
          <div className="flex items-start gap-2">
            <Package className={cn("w-4 h-4 mt-0.5 shrink-0", col.text)} />
            <ul className="text-sm text-gray-800 space-y-0.5">
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
        <div className={cn("px-4 py-3 border-t border-gray-100", col.bgLight)}>
          <p className="text-sm text-gray-600 italic">{p.resumo}</p>
        </div>
      )}

      {/* Endereço + valor */}
      <div className="px-4 py-3 space-y-2">
        {p.endereco && enderecoLink && (
          <a href={enderecoLink} target="_blank" rel="noreferrer"
            className="flex items-start gap-2 text-sm text-blue-600 hover:underline">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{enderecoIsCoords ? "Ver no Maps" : p.endereco}</span>
          </a>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <CreditCard className="w-4 h-4" />
            <span>{p.pagamento ?? "—"}</span>
            {p.pix_link && (
              <a href={p.pix_link} target="_blank" rel="noreferrer"
                className="ml-1 text-blue-600 text-xs hover:underline font-medium">ver PIX</a>
            )}
          </div>
          {p.valor_total != null && (
            <span className="text-xl font-extrabold text-gray-900">{formatCurrency(p.valor_total)}</span>
          )}
        </div>

        {entregadorNome && (
          <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
            <Truck className="w-4 h-4 shrink-0" />
            <span>Entregador: <span className="font-medium text-gray-700">{entregadorNome}</span></span>
          </div>
        )}
        {despacho?.pagamento_recebido?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="text-xs text-gray-500">Recebido:</span>
            {despacho.pagamento_recebido.map((pg, i) => (
              <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {pg.forma} R$ {pg.valor.toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Ações */}
      {(next || isEmSeparacao || canCancel) && (
        <div className="px-4 pb-4 flex gap-2">
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
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors shrink-0"
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
}: {
  p: Pedido;
  entregadores: EntregadorFull[];
  onConfirmarEntrega: (id: string) => Promise<void>;
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
    <div className="rounded-2xl border border-violet-200 bg-violet-50 shadow-md overflow-hidden border-l-4 border-l-violet-500">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-lg font-bold text-gray-900">{nome}</p>
          {p.created_at && (
            <span className="text-xs text-gray-400 mt-1 shrink-0">{timeAgo(p.created_at)}</span>
          )}
        </div>
        {phone && (
          <a
            href={`https://wa.me/55${phone}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-700 mt-1"
          >
            <Phone className="w-4 h-4" />{phone}
          </a>
        )}
      </div>

      <div className="px-4 pb-3 space-y-2">
        {/* Entregador */}
        {entregador && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Truck className="w-4 h-4 shrink-0 text-violet-500" />
            <span>{entregador.nome}</span>
            {entregador.telefone && (
              <a
                href={`https://wa.me/${entregador.telefone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="text-green-600 hover:text-green-700"
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
            className="flex items-start gap-2 text-sm text-blue-600 hover:underline"
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
            className="flex items-center gap-1.5 text-xs text-violet-600 hover:underline"
          >
            <LocateFixed className="w-3.5 h-3.5" />GPS atual
          </a>
        )}

        {/* Saiu / Chegou */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          {despacho?.saiu_em && (
            <span className="flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5 text-violet-400" />
              Saiu às {format(new Date(despacho.saiu_em), "HH:mm", { locale: ptBR })}
            </span>
          )}
          {despacho?.chegou_em ? (
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Chegou às {format(new Date(despacho.chegou_em), "HH:mm", { locale: ptBR })}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-500">
              <Clock className="w-3.5 h-3.5" />A caminho...
            </span>
          )}
        </div>

        {/* Valor + pagamento */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">{p.pagamento ?? "—"}</span>
          {p.valor_total != null && (
            <span className="text-xl font-extrabold text-gray-900">{formatCurrency(p.valor_total)}</span>
          )}
        </div>

        {/* Pagamento recebido */}
        {despacho?.pagamento_recebido?.length ? (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-gray-500">Recebido:</span>
            {despacho.pagamento_recebido.map((pg, i) => (
              <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {pg.forma} R$ {pg.valor.toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Confirmar entregue */}
      <div className="px-4 pb-4">
        <button
          disabled={confirming}
          onClick={handleConfirmar}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-60"
        >
          {confirming
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <><CheckCircle className="w-4 h-4" />Marcar como entregue</>}
        </button>
      </div>
    </div>
  );
}

// ─── PinInput ─────────────────────────────────────────────────────────────────

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

// ─── EntregadoresModal ────────────────────────────────────────────────────────

type ModalView = "list" | "pin" | "novo";

function EntregadoresModal({
  open,
  onClose,
  entregadores,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  entregadores: EntregadorFull[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<ModalView>("list");
  const [ativo, setAtivo] = useState<EntregadorFull | null>(null);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTel, setNovoTel] = useState("");
  const [novoPin, setNovoPin] = useState(["", "", "", ""]);

  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const novoPinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  function resetAndClose() { onClose(); setView("list"); setAtivo(null); }

  function abrirPin(e: EntregadorFull) {
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
      onRefresh();
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
      onRefresh();
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
                        <Button size="sm" variant="ghost" onClick={() => abrirPin(e)} title="Redefinir PIN">
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button></>
                    : <Button size="sm" variant="outline" onClick={() => abrirPin(e)}>Criar login</Button>}
                </div>
              </div>
            ))}
            <Button
              className="w-full mt-2"
              onClick={() => { setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]); setView("novo"); }}
            >
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
              <Button
                className="flex-1"
                onClick={cadastrarEntregador}
                disabled={loading || !novoNome.trim() || !novoTel.trim()}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cadastrar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TODOS_STATUS = COLUNAS.map((c) => c.status);
const STATUS_ATIVOS_DEFAULT = ["novo", "em_separacao", "saiu_para_entrega"];

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [entregadores, setEntregadores] = useState<EntregadorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtros, setFiltros] = useState<string[]>(STATUS_ATIVOS_DEFAULT);
  const [aba, setAba] = useState<"kanban" | "na_rua">("kanban");
  const [entregadoresOpen, setEntregadoresOpen] = useState(false);
  const [despacharPedido, setDespacharPedido] = useState<Pedido | null>(null);

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
        .select("*, clientes(nome, telefone), itens_pedido(item, quantidade), despacho_entrega(id, entregador_id, pagamento_recebido, saiu_em, chegou_em, localizacao, status_entrega)")
        .order("created_at", { ascending: false }),
      externalSupabase.from("entregadores").select("*").eq("ativo", true),
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
    const telefoneCliente = pedido?.clientes?.telefone;
    if (telefoneCliente) {
      if (newStatus === "em_separacao") {
        notifyWhatsApp(telefoneCliente, "🏥 Seu pedido está sendo separado! Logo sairá para entrega.");
      }
    }
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
      notifyWhatsApp(telefoneCliente, "✅ Seu pedido foi entregue! Obrigado pela preferência. 🙏");
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  const byStatus = (status: string) => pedidos.filter((p) => p.status === status);
  const naRua = pedidos.filter((p) => p.status === "saiu_para_entrega");

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
          <h1 className="text-2xl font-extrabold text-foreground">Pedidos</h1>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEntregadoresOpen(true)}
              className="h-8"
            >
              <Users className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Entregadores</span>
            </Button>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
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
              aba === "na_rua" ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <Truck className="w-4 h-4" />
            Na rua
            {naRua.length > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-xs font-bold",
                aba === "na_rua" ? "bg-white/20 text-white" : "bg-violet-600 text-white"
              )}>
                {naRua.length}
              </span>
            )}
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
                {col.emoji} {col.label}
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
                      <span className={cn("font-bold text-base", col.text)}>{col.emoji} {col.label}</span>
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modais */}
      <EntregadoresModal
        open={entregadoresOpen}
        onClose={() => setEntregadoresOpen(false)}
        entregadores={entregadores}
        onRefresh={() => load(true)}
      />

      {despacharPedido && (
        <DespacharModal
          pedido={despacharPedido}
          entregadores={entregadores}
          open={!!despacharPedido}
          onClose={() => setDespacharPedido(null)}
          onDone={() => load(true)}
        />
      )}
    </div>
  );
}
