import { useEffect, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Phone, MapPin, CreditCard, Package, ChevronRight, X } from "lucide-react";

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

const COLUNAS: { status: string; label: string; headerColor: string; borderColor: string }[] = [
  { status: "novo",          label: "🆕 Novos",      headerColor: "bg-blue-50",   borderColor: "border-blue-200" },
  { status: "em_separacao",  label: "📦 Separação",  headerColor: "bg-yellow-50", borderColor: "border-yellow-200" },
  { status: "saiu_para_entrega",  label: "🛵 Saindo",     headerColor: "bg-orange-50", borderColor: "border-orange-200" },
  { status: "entregue",           label: "✅ Concluído",   headerColor: "bg-green-50",  borderColor: "border-green-200" },
  { status: "cancelado",     label: "❌ Cancelado",   headerColor: "bg-red-50",    borderColor: "border-red-200" },
];

const BADGE_CLASS: Record<string, string> = {
  novo:         "bg-blue-100 text-blue-800",
  em_separacao: "bg-yellow-100 text-yellow-800",
  saiu_para_entrega:  "bg-orange-100 text-orange-800",
  entregue:           "bg-green-100 text-green-800",
  cancelado:    "bg-red-100 text-red-800",
};


const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  novo:              { status: "em_separacao",      label: "Iniciar Separação" },
  em_separacao:      { status: "saiu_para_entrega", label: "Despachar" },
  saiu_para_entrega: { status: "entregue",          label: "Confirmar Entrega" },
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

function OrderCard({ p, onStatusChange }: { p: Pedido; onStatusChange: (id: string, newStatus: string) => Promise<void> }) {
  const phone = formatPhone(p.clientes?.telefone ?? null);
  const nome = p.clientes?.nome ?? "Cliente";
  const itensTexto = p.itens_pedido
    ?.filter((i) => i.item && i.item !== "[object Object]")
    .map((i) => `${i.quantidade}x ${i.item}`)
    .join(", ");
  const enderecoIsCoords = p.endereco ? isCoords(p.endereco) : false;
  const mapsLink = enderecoIsCoords
    ? `https://maps.google.com/?q=${p.endereco}`
    : p.endereco
    ? `https://maps.google.com/?q=${encodeURIComponent(p.endereco)}`
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800 leading-tight">{nome}</p>
          {phone && (
            <a
              href={`https://wa.me/55${phone}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-green-600 hover:underline mt-0.5"
            >
              <Phone className="w-3 h-3" /> {phone}
            </a>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {p.created_at ? timeAgo(p.created_at) : ""}
        </span>
      </div>

      {/* Items */}
      {itensTexto && (
        <div className="flex items-start gap-1.5 text-sm text-gray-600">
          <Package className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
          <span className="line-clamp-2">{itensTexto}</span>
        </div>
      )}

      {/* Resumo (fallback se sem itens) */}
      {!itensTexto && p.resumo && (
        <p className="text-xs text-gray-500 italic line-clamp-2">{p.resumo}</p>
      )}

      {/* Endereço */}
      {p.endereco && mapsLink && (
        <a
          href={mapsLink}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-1.5 text-xs text-blue-600 hover:underline"
        >
          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="line-clamp-1">
            {enderecoIsCoords ? "Ver no Maps" : p.endereco}
          </span>
        </a>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <CreditCard className="w-3.5 h-3.5" />
          {p.pagamento ?? "—"}
        </div>
        {p.valor_total != null && (
          <span className="text-sm font-bold text-gray-800">
            {formatCurrency(p.valor_total)}
          </span>
        )}
        {p.pix_link && (
          <a
            href={p.pix_link}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            PIX
          </a>
        )}
      </div>

      {/* Action buttons */}
      {(next || canCancel) && (
        <div className="flex gap-2 pt-1">
          {next && (
            <Button
              size="sm"
              className="flex-1 h-8 text-xs"
              disabled={updating}
              onClick={() => advance(next.status)}
            >
              {updating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <ChevronRight className="w-3 h-3 mr-1" />
                  {next.label}
                </>
              )}
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-red-500 border-red-200 hover:bg-red-50"
              disabled={updating}
              onClick={() => advance("cancelado")}
            >
              <X className="w-3 h-3" />
            </Button>
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
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const byStatus = (status: string) => pedidos.filter((p) => p.status === status);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Pedidos</h1>
          <p className="text-xs text-gray-400">Atualiza a cada 30s</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{pedidos.length} total</Badge>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-4 p-4 overflow-x-auto">
        {COLUNAS.map(({ status, label, headerColor, borderColor }) => {
          const items = byStatus(status);
          return (
            <div
              key={status}
              className={`flex-shrink-0 w-72 rounded-xl border ${borderColor} flex flex-col`}
            >
              <div className={`flex items-center justify-between px-4 py-3 ${headerColor} border-b ${borderColor}`}>
                <span className="font-semibold text-sm text-gray-700">{label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BADGE_CLASS[status] ?? "bg-gray-100 text-gray-600"}`}>
                  {items.length}
                </span>
              </div>
              <div className="flex flex-col gap-3 p-3 overflow-y-auto max-h-[calc(100vh-220px)]">
                {items.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-6">Nenhum pedido</p>
                ) : (
                  items.map((p) => <OrderCard key={p.id} p={p} onStatusChange={handleStatusChange} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
