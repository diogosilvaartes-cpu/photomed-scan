import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, ShoppingBag, Truck, CircleCheckBig, Clock, type LucideIcon } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { STATUS, STATUS_ORDER, STATUS_ATIVOS, statusConfig, brl, moneyClass, type PedidoStatus } from "@/lib/status";

async function fetchDashboard() {
  const hoje = new Date();
  const inicio = startOfDay(hoje).toISOString();
  const fim = endOfDay(hoje).toISOString();

  const [{ data: todos }, { data: hoje_data }] = await Promise.all([
    externalSupabase.from("pedidos").select("id, status, valor_total, created_at"),
    externalSupabase.from("pedidos").select("id, status, valor_total").gte("created_at", inicio).lte("created_at", fim),
  ]);

  const porStatus = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, (todos ?? []).filter((p) => p.status === s).length])
  );

  const totalFaturado = (todos ?? [])
    .filter((p) => p.status === "entregue")
    .reduce((s, p) => s + (p.valor_total ?? 0), 0);

  const faturadoHoje = (hoje_data ?? [])
    .filter((p) => p.status === "entregue")
    .reduce((s, p) => s + (p.valor_total ?? 0), 0);

  const pedidosHoje = hoje_data?.length ?? 0;
  const emAndamento = (todos ?? []).filter((p) => STATUS_ATIVOS.includes(p.status as PedidoStatus)).length;

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

/** Card de métrica — os quatro têm estrutura e alinhamento idênticos. */
function StatCard({ Icon, iconClass, label, value, valueClass, sub }: {
  Icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex items-start gap-3">
      <div className={cn("shrink-0 w-10 h-10 rounded-xl flex items-center justify-center", iconClass)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
        <p className={cn("font-display text-2xl font-extrabold leading-tight tabular mt-0.5", valueClass ?? "text-foreground")}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
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
        <h1 className="font-display text-3xl font-extrabold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground capitalize mt-0.5">{hoje}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard
              Icon={ShoppingBag}
              iconClass="bg-status-novo/10 text-status-ink-novo"
              label="Pedidos hoje"
              value={String(data?.pedidosHoje ?? 0)}
            />
            <StatCard
              Icon={Truck}
              iconClass="bg-status-rua/10 text-status-ink-rua"
              label="Em andamento"
              value={String(data?.emAndamento ?? 0)}
            />
            <StatCard
              Icon={TrendingUp}
              iconClass="bg-money/10 text-money"
              label="Faturado hoje"
              value={brl(data?.faturadoHoje ?? 0)}
              valueClass={moneyClass(data?.faturadoHoje)}
            />
            <StatCard
              Icon={CircleCheckBig}
              iconClass="bg-primary/10 text-primary"
              label="Total faturado"
              value={`R$ ${(data?.totalFaturado ?? 0).toFixed(0)}`}
              valueClass={moneyClass(data?.totalFaturado)}
              sub="todos os tempos"
            />
          </div>

          {/* Status atual */}
          <div className="mb-8">
            <h2 className="section-title">Status atual</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {STATUS_ORDER.map((status) => {
                const cfg = STATUS[status];
                return (
                  <div
                    key={status}
                    className={cn("rounded-xl border px-3 py-3 flex items-center gap-2.5", cfg.pill)}
                  >
                    <cfg.Icon className="w-5 h-5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{cfg.plural}</p>
                      <p className="font-display text-xl font-extrabold leading-tight tabular">
                        {data?.porStatus[status] ?? 0}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Últimos pedidos */}
          <div>
            <h2 className="section-title">Últimos pedidos</h2>
            <div className="space-y-2">
              {(ultimos ?? []).map((p: any) => {
                const cfg = statusConfig(p.status);
                return (
                  <div
                    key={p.id}
                    className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 shadow-card"
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
                        {format(new Date(p.created_at), "dd/MM HH:mm", { locale: ptBR })}
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
