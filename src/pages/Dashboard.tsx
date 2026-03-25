import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, ShoppingBag, Truck, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  novo:              { label: "Novos",      emoji: "🆕", color: "bg-blue-50 text-blue-700 border-blue-200" },
  em_separacao:      { label: "Separação",  emoji: "📦", color: "bg-amber-50 text-amber-700 border-amber-200" },
  saiu_para_entrega: { label: "Na rua",     emoji: "🛵", color: "bg-violet-50 text-violet-700 border-violet-200" },
  entregue:          { label: "Entregues",  emoji: "✅", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelado:         { label: "Cancelados", emoji: "❌", color: "bg-red-50 text-red-700 border-red-200" },
};

async function fetchDashboard() {
  const hoje = new Date();
  const inicio = startOfDay(hoje).toISOString();
  const fim = endOfDay(hoje).toISOString();

  const [{ data: todos }, { data: hoje_data }] = await Promise.all([
    externalSupabase.from("pedidos").select("id, status, valor_total, created_at"),
    externalSupabase.from("pedidos").select("id, status, valor_total").gte("created_at", inicio).lte("created_at", fim),
  ]);

  const porStatus = Object.fromEntries(
    Object.keys(STATUS_CONFIG).map((s) => [s, (todos ?? []).filter((p) => p.status === s).length])
  );

  const totalFaturado = (todos ?? [])
    .filter((p) => p.status === "entregue")
    .reduce((s, p) => s + (p.valor_total ?? 0), 0);

  const faturadoHoje = (hoje_data ?? [])
    .filter((p) => p.status === "entregue")
    .reduce((s, p) => s + (p.valor_total ?? 0), 0);

  const pedidosHoje = hoje_data?.length ?? 0;
  const emAndamento = (todos ?? []).filter((p) => ["novo", "em_separacao", "saiu_para_entrega"].includes(p.status ?? "")).length;

  return { porStatus, totalFaturado, faturadoHoje, pedidosHoje, emAndamento };
}

async function fetchUltimosPedidos() {
  const { data } = await externalSupabase
    .from("pedidos")
    .select("id, status, valor_total, created_at, clientes(nome, telefone)")
    .order("created_at", { ascending: false })
    .limit(8);
  return data ?? [];
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className={cn("rounded-2xl border p-4 flex items-center gap-4", color)}>
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium opacity-70 truncate">{label}</p>
        <p className="text-2xl font-extrabold leading-tight">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    refetchInterval: 30_000,
  });

  const { data: ultimos } = useQuery({
    queryKey: ["dashboard-ultimos"],
    queryFn: fetchUltimosPedidos,
    refetchInterval: 30_000,
  });

  const hoje = format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground capitalize mt-0.5">{hoje}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Cards de destaque */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard
              icon={<ShoppingBag className="w-7 h-7 text-blue-600" />}
              label="Pedidos hoje"
              value={String(data?.pedidosHoje ?? 0)}
              color="bg-blue-50 border-blue-200 text-blue-900"
            />
            <StatCard
              icon={<Truck className="w-7 h-7 text-violet-600" />}
              label="Em andamento"
              value={String(data?.emAndamento ?? 0)}
              color="bg-violet-50 border-violet-200 text-violet-900"
            />
            <StatCard
              icon={<TrendingUp className="w-7 h-7 text-emerald-600" />}
              label="Faturado hoje"
              value={`R$ ${(data?.faturadoHoje ?? 0).toFixed(2)}`}
              color="bg-emerald-50 border-emerald-200 text-emerald-900"
            />
            <StatCard
              icon={<CheckCircle className="w-7 h-7 text-green-600" />}
              label="Total faturado"
              value={`R$ ${(data?.totalFaturado ?? 0).toFixed(0)}`}
              sub="todos os tempos"
              color="bg-green-50 border-green-200 text-green-900"
            />
          </div>

          {/* Pedidos por status */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status atual</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
                <div key={status} className={cn("rounded-xl border px-4 py-3 flex items-center gap-2", cfg.color)}>
                  <span className="text-lg">{cfg.emoji}</span>
                  <div>
                    <p className="text-xs opacity-70">{cfg.label}</p>
                    <p className="text-xl font-bold">{data?.porStatus[status] ?? 0}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Últimos pedidos */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Últimos pedidos</h2>
            <div className="space-y-2">
              {(ultimos ?? []).map((p: any) => {
                const cfg = STATUS_CONFIG[p.status] ?? { label: p.status, emoji: "•", color: "bg-secondary border-border text-foreground" };
                return (
                  <div key={p.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-base shrink-0">{cfg.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.clientes?.nome ?? p.clientes?.telefone ?? "—"}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(p.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {p.valor_total != null && (
                        <p className="text-sm font-semibold">R$ {p.valor_total.toFixed(2)}</p>
                      )}
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", cfg.color)}>{cfg.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
