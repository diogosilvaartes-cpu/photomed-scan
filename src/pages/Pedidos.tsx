import { useEffect, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Loader2, RefreshCw, Phone, MapPin, CreditCard, Package, ChevronRight, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  item: string;
  quantidade: number;
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
}

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

const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  novo: { status: "em_separacao", label: "Iniciar Separação" },
  em_separacao: { status: "saiu_para_entrega", label: "Despachar" },
  saiu_para_entrega: { status: "entregue", label: "Confirmar Entrega" },
};

const CANCELABLE = ["novo", "em_separacao", "saiu_para_entrega"];

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

function OrderCard({
  p,
  col,
  onStatusChange,
}: {
  p: Pedido;
  col: ColConfig;
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
}) {
  const phone = formatPhone(p.clientes?.telefone ?? null);
  const nome = p.clientes?.nome ?? "Cliente";
  const itens = p.itens_pedido?.filter((i) => i.item && i.item !== "[object Object]") ?? [];
  const enderecoIsCoords = p.endereco ? isCoords(p.endereco) : false;
  const mapsLink = p.endereco
    ? enderecoIsCoords
      ? `https://maps.google.com/?q=${p.endereco}`
      : `https://maps.google.com/?q=${encodeURIComponent(p.endereco)}`
    : null;

  const [updating, setUpdating] = useState(false);
  const next = p.status ? NEXT_STATUS[p.status] : null;
  const canCancel = p.status ? CANCELABLE.includes(p.status) : false;

  async function advance(newStatus: string) {
    setUpdating(true);
    await onStatusChange(p.id, newStatus);
    setUpdating(false);
  }

  return (
    <div className={cn("bg-white rounded-2xl border-l-4 shadow-sm overflow-hidden border border-gray-100", col.cardAccent)}>
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
        {p.endereco && mapsLink && (
          <a href={mapsLink} target="_blank" rel="noreferrer"
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
      </div>

      {/* Ações */}
      {(next || canCancel) && (
        <div className="px-4 pb-4 flex gap-2">
          {next && col.actionBg && (
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

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("novo");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const { data } = await externalSupabase
      .from("pedidos")
      .select("*, clientes(nome, telefone), itens_pedido(item, quantidade)")
      .order("created_at", { ascending: false });
    setPedidos((data as unknown as Pedido[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function handleStatusChange(id: string, newStatus: string) {
    await externalSupabase.from("pedidos").update({ status: newStatus }).eq("id", id);
    setPedidos((prev) => prev.map((p) => (p.id === id ? { ...p, status: newStatus } : p)));
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  const byStatus = (status: string) => pedidos.filter((p) => p.status === status);
  const activeCol = COLUNAS.find((c) => c.status === activeTab)!;

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
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-extrabold text-foreground">Pedidos</h1>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>

        {/* Pills de status */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          {COLUNAS.map((col) => {
            const count = byStatus(col.status).length;
            const isActive = activeTab === col.status;
            return (
              <button
                key={col.status}
                onClick={() => setActiveTab(col.status)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shrink-0 transition-all",
                  isActive ? cn(col.bg, "text-white shadow-md") : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                )}
              >
                <span>{col.emoji}</span>
                <span>{col.label}</span>
                {count > 0 && (
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                    isActive ? "bg-white/30" : col.badge
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">

        {/* Mobile: lista vertical */}
        <div className="md:hidden p-4 space-y-3">
          {byStatus(activeTab).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <span className="text-5xl mb-3">{activeCol.emoji}</span>
              <p className="text-base font-medium">Nenhum pedido aqui</p>
            </div>
          ) : (
            byStatus(activeTab).map((p) => (
              <OrderCard key={p.id} p={p} col={activeCol} onStatusChange={handleStatusChange} />
            ))
          )}
        </div>

        {/* Desktop: kanban */}
        <div className="hidden md:flex gap-4 p-5 overflow-x-auto items-start min-h-full">
          {COLUNAS.map((col) => {
            const items = byStatus(col.status);
            return (
              <div key={col.status} className="flex-shrink-0 w-80 flex flex-col gap-3">
                <div className={cn("flex items-center justify-between px-4 py-2.5 rounded-xl", col.bgLight)}>
                  <span className={cn("font-bold text-base", col.text)}>{col.emoji} {col.label}</span>
                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", col.badge)}>{items.length}</span>
                </div>
                <div className="flex flex-col gap-3 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-10">Nenhum pedido</p>
                  ) : (
                    items.map((p) => (
                      <OrderCard key={p.id} p={p} col={col} onStatusChange={handleStatusChange} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
