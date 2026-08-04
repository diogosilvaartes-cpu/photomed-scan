import { Inbox, Package, Bike, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";

/**
 * Fonte única de verdade dos status de pedido.
 *
 * As chaves são EXATAMENTE as strings gravadas na coluna `pedidos.status`
 * do Supabase — nunca renomear. Os workflows do n8n dependem delas.
 *
 * Regra de design: status é sempre cor + ícone + rótulo. Nunca só cor.
 */

export const STATUS_ORDER = [
  "novo",
  "em_separacao",
  "saiu_para_entrega",
  "entregue",
  "cancelado",
] as const;

export type PedidoStatus = (typeof STATUS_ORDER)[number];

/** Status que ainda estão em aberto na operação. */
export const STATUS_ATIVOS: PedidoStatus[] = ["novo", "em_separacao", "saiu_para_entrega"];

/** Status que ainda podem ser cancelados. */
export const CANCELAVEIS: PedidoStatus[] = ["novo", "em_separacao", "saiu_para_entrega"];

interface StatusConfig {
  /** Rótulo no singular — badges e cards. */
  label: string;
  /** Rótulo no plural — contadores e colunas. */
  plural: string;
  Icon: LucideIcon;
  /** Pastilha/badge: fundo suave + texto e borda na cor forte. */
  pill: string;
  /** Só a cor do ícone. */
  icon: string;
  /** Preenchimento sólido — usar com parcimônia (botão de ação principal). */
  solid: string;
  /** Faixa de acento — topo de coluna do kanban, borda lateral de card. */
  accent: string;
}

export const STATUS: Record<PedidoStatus, StatusConfig> = {
  novo: {
    label: "Novo",
    plural: "Novos",
    Icon: Inbox,
    pill: "bg-status-novo/10 text-status-ink-novo border-status-novo/30",
    icon: "text-status-ink-novo",
    solid: "bg-status-novo text-white",
    accent: "bg-status-novo",
  },
  em_separacao: {
    label: "Separação",
    plural: "Separação",
    Icon: Package,
    pill: "bg-status-separacao/10 text-status-ink-separacao border-status-separacao/30",
    icon: "text-status-ink-separacao",
    solid: "bg-status-separacao text-white",
    accent: "bg-status-separacao",
  },
  saiu_para_entrega: {
    label: "Na rua",
    plural: "Na rua",
    Icon: Bike,
    pill: "bg-status-rua/10 text-status-ink-rua border-status-rua/30",
    icon: "text-status-ink-rua",
    solid: "bg-status-rua text-white",
    accent: "bg-status-rua",
  },
  entregue: {
    label: "Entregue",
    plural: "Entregues",
    Icon: CheckCircle2,
    pill: "bg-status-entregue/10 text-status-ink-entregue border-status-entregue/30",
    icon: "text-status-ink-entregue",
    solid: "bg-status-entregue text-white",
    accent: "bg-status-entregue",
  },
  cancelado: {
    label: "Cancelado",
    plural: "Cancelados",
    Icon: XCircle,
    pill: "bg-status-cancelado/10 text-status-ink-cancelado border-status-cancelado/30",
    icon: "text-status-ink-cancelado",
    solid: "bg-status-cancelado text-white",
    accent: "bg-status-cancelado",
  },
};

/** Fallback seguro para status desconhecido vindo do banco. */
const DESCONHECIDO: StatusConfig = {
  label: "—",
  plural: "—",
  Icon: Package,
  pill: "bg-muted text-muted-foreground border-border",
  icon: "text-muted-foreground",
  solid: "bg-muted text-muted-foreground",
  accent: "bg-border",
};

export function statusConfig(status: string | null | undefined): StatusConfig {
  if (status && status in STATUS) return STATUS[status as PedidoStatus];
  return { ...DESCONHECIDO, label: status ?? "—", plural: status ?? "—" };
}

/** Formata em BRL. Devolve string vazia quando não há valor. */
export function brl(valor: number | null | undefined): string {
  if (valor == null) return "";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Classe do valor monetário: verde só quando entra dinheiro de verdade.
 * R$ 0,00 em verde é ruído — fica neutro.
 */
export function moneyClass(valor: number | null | undefined): string {
  return valor && valor > 0 ? "text-money font-bold tabular" : "text-muted-foreground font-semibold tabular";
}
