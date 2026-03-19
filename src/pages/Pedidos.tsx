import { useEffect, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Phone, MapPin, CreditCard, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Pedido {
  id: string;
  status: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  resumo_itens: string | null;
  tipo_entrega: string | null;
  endereco_entrega: string | null;
  forma_pagamento: string | null;
  valor_total: number | null;
  entregador_nome: string | null;
  criado_em: string | null;
  atualizado_em: string | null;
}

const COLUNAS: { status: string; label: string; color: string }[] = [
  { status: "novo", label: "🆕 Novos", color: "bg-blue-50 border-blue-200" },
  { status: "em_separacao", label: "📦 Separação", color: "bg-yellow-50 border-yellow-200" },
  { status: "saindo", label: "🛵 Saindo", color: "bg-orange-50 border-orange-200" },
  { status: "concluido", label: "✅ Concluídos", color: "bg-green-50 border-green-200" },
  { status: "cancelado", label: "❌ Cancelados", color: "bg-red-50 border-red-200" },
];

const STATUS_BADGE: Record<string, string> = {
  novo: "bg-blue-100 text-blue-800",
  em_separacao: "bg-yellow-100 text-yellow-800",
  saindo: "bg-orange-100 text-orange-800",
  concluido: "bg-green-100 text-green-800",
  cancelado: "bg-red-100 text-red-800",
};

function formatPhone(tel: string) {
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

function OrderCard({ p }: { p: Pedido }) {
  const phone = p.cliente_telefone ? formatPhone(p.cliente_telefone) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800 leading-tight">
            {p.cliente_nome ?? "Cliente"}
          </p>
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
          {p.criado_em ? timeAgo(p.criado_em) : ""}
        </span>
      </div>

      {/* Items */}
      {p.resumo_itens && (
        <div className="flex items-start gap-1.5 text-sm text-gray-600">
          <Package className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
          <span className="line-clamp-2">{p.resumo_itens}</span>
        </div>
      )}

      {/* Delivery */}
      {p.endereco_entrega && (
        <div className="flex items-start gap-1.5 text-xs text-gray-500">
          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="line-clamp-1">{p.endereco_entrega}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <CreditCard className="w-3.5 h-3.5" />
          {p.forma_pagamento ?? "—"}
        </div>
        {p.valor_total != null && (
          <span className="text-sm font-bold text-gray-800">
            {formatCurrency(p.valor_total)}
          </span>
        )}
      </div>

      {/* Driver */}
      {p.entregador_nome && (
        <div className="text-xs text-gray-400 italic">
          Entregador: {p.entregador_nome}
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
      .from("painel_pedidos")
      .select("*")
      .order("criado_em", { ascending: false });

    setPedidos(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const byStatus = (status: string) =>
    pedidos.filter((p) => p.status === status);

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-4 p-4 overflow-x-auto">
        {COLUNAS.map(({ status, label, color }) => {
          const items = byStatus(status);
          return (
            <div
              key={status}
              className={`flex-shrink-0 w-72 rounded-xl border ${color} flex flex-col`}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-inherit">
                <span className="font-semibold text-sm text-gray-700">{label}</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    STATUS_BADGE[status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-3 p-3 overflow-y-auto max-h-[calc(100vh-220px)]">
                {items.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-6">
                    Nenhum pedido
                  </p>
                ) : (
                  items.map((p) => <OrderCard key={p.id} p={p} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
