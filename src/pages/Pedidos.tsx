import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/external-client";
import {
  Loader2, RefreshCw, Phone, CreditCard, Package, ChevronRight, X, Clock,
  Truck, Navigation, LocateFixed, CheckCircle, Eye, FileText, History, Plus, AlarmClock, Search,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { STATUS, statusConfig, brl, moneyClass } from "@/lib/status";
import FichaPedido from "@/components/FichaPedido";
import DespacharModal from "@/components/DespacharModal";
import NovoPedidoModal from "@/components/NovoPedidoModal";
import CodigoPedido from "@/components/CodigoPedido";
import EnderecoLink from "@/components/EnderecoLink";
import MotivoCancelamento from "@/components/MotivoCancelamento";
import ConfirmarPagamentoModal from "@/components/ConfirmarPagamentoModal";
import { confirmarEntregaPedido, pagamentoJaRegistrado } from "@/lib/confirmarEntrega";
import { useOperador } from "@/lib/operador";
import AgendadosLista, {
  type PedidoAgendado, AGENDADO_SELECT, AGENDADO_PENDENTES,
} from "@/components/AgendadosLista";
import {
  type Pedido, type EntregadorFull, type ItemPagamento,
  PEDIDO_SELECT, formatPhone, formatCurrency, timeAgo, pedidoNumero,
} from "@/lib/pedido";
import { format, addDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Busca e filtro de data ───────────────────────────────────────────────────

/** `yyyy-MM-dd` no fuso do navegador — o balcão pensa no dia dele, não em UTC. */
const diaDe = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd") : null;

/**
 * Texto que a busca varre em um pedido. Junta tudo num campo só porque o balcão
 * procura por qualquer coisa que lembre — "04ago", "dipirona", "Mario Castanho",
 * o final do telefone — e não por um campo específico.
 */
function textoBusca(p: Pedido): string {
  return [
    p.codigo,
    p.clientes?.nome,
    p.clientes?.telefone,
    p.endereco,
    p.pagamento,
    p.resumo,
    p.pessoa_recebimento,
    ...(p.itens_pedido ?? []).map((i) => i.item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function textoBuscaAgendado(a: PedidoAgendado): string {
  const itens = Array.isArray(a.itens) ? a.itens : [];
  return [a.codigo, a.nome_cliente, a.telefone, a.endereco, a.pagamento, a.resumo, ...itens.map((i) => i.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Normaliza acento para "jose" achar "José" e vice-versa. */
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function casaBusca(alvo: string, termo: string) {
  const t = semAcento(termo.trim().toLowerCase());
  if (!t) return true;
  const a = semAcento(alvo);
  // Todos os pedaços precisam bater: "mario dipirona" acha o pedido do Mario com dipirona.
  return t.split(/\s+/).every((parte) => a.includes(parte));
}

/** Rótulo humano de um dia: "Hoje", "Ontem" ou "qua, 05/08". */
export function rotuloDia(iso: string, hojeStr = format(new Date(), "yyyy-MM-dd")) {
  const ontemStr = format(addDays(new Date(hojeStr + "T12:00:00"), -1), "yyyy-MM-dd");
  if (iso === hojeStr) return "Hoje";
  if (iso === ontemStr) return "Ontem";
  const d = new Date(iso + "T12:00:00");
  return `${format(d, "EEEE", { locale: ptBR })}, ${format(d, "dd/MM")}`;
}

/**
 * Filtro de dia: **os últimos 7 dias, rolando**.
 *
 * A primeira versão mostrava a semana corrente (segunda até hoje) e numa
 * quarta-feira sumiam sexta, sábado e domingo — justo os dias que o balcão mais
 * procura de manhã. Rolando, os sete dias da semana estão SEMPRE lá, e nenhum
 * chip volta vazio por ser futuro.
 *
 * Para além disso, o seletor de data nativo: um dia específico é raro o
 * suficiente para não merecer chip, e no celular ele abre o calendário do
 * sistema, que o balcão já sabe usar.
 */
function FiltroData({
  dia,
  onChange,
  contar,
}: {
  dia: string | null;
  onChange: (d: string | null) => void;
  contar: (d: string | null) => number;
}) {
  const hoje = startOfDay(new Date());
  const hojeStr = format(hoje, "yyyy-MM-dd");

  // Hoje primeiro, andando para trás: é a ordem em que o balcão procura.
  const dias = Array.from({ length: 7 }, (_, i) => addDays(hoje, -i)).map((d) => ({
    valor: format(d, "yyyy-MM-dd"),
    // "Hoje"/"Ontem" ganham do nome do dia — ninguém pensa "terça" para ontem.
    rotulo:
      i0(d, hoje) === 0 ? "Hoje"
        : i0(d, hoje) === 1 ? "Ontem"
          : `${format(d, "EEE", { locale: ptBR }).replace(".", "")} ${format(d, "dd")}`,
  }));

  // Dia escolhido no calendário que não está entre os 7 chips: vira um chip extra
  // no fim, senão o filtro fica ativo sem nada aceso na tela.
  const fora = dia && !dias.some((d) => d.valor === dia) ? dia : null;

  const Chip = ({
    ativo,
    onClick,
    children,
  }: {
    ativo: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors capitalize",
        ativo
          ? "bg-primary text-primary-foreground border-transparent"
          : "bg-background text-muted-foreground border-border hover:text-foreground",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      <Chip ativo={dia === null} onClick={() => onChange(null)}>
        Tudo <span className="opacity-70">{contar(null)}</span>
      </Chip>
      <span className="shrink-0 w-px self-stretch bg-border my-1" aria-hidden />
      {dias.map((d) => (
        <Chip key={d.valor} ativo={dia === d.valor} onClick={() => onChange(d.valor)}>
          {d.rotulo}
          <span className="ml-1 opacity-70">{contar(d.valor)}</span>
        </Chip>
      ))}
      {fora && (
        <Chip ativo onClick={() => onChange(null)}>
          {format(new Date(fora + "T12:00:00"), "dd/MM")}
          <span className="ml-1 opacity-70">{contar(fora)}</span>
        </Chip>
      )}
      {/* Input nativo, e não um calendário nosso: no celular ele abre o
          seletor do sistema, que o balcão já sabe usar. */}
      <label
        title="Escolher outra data"
        className="shrink-0 flex items-center gap-1 h-[30px] pl-2.5 pr-1.5 rounded-full border border-border bg-background text-xs font-bold text-muted-foreground focus-within:text-foreground"
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
        <input
          type="date"
          value={dia ?? ""}
          max={hojeStr}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-[112px] bg-transparent text-xs font-bold focus:outline-none"
        />
      </label>
    </div>
  );
}

/** Diferença em dias inteiros entre duas datas já normalizadas ao início do dia. */
function i0(a: Date, b: Date) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
}

/**
 * Agrupa por dia, do mais recente para o mais antigo.
 *
 * A lista já vem ordenada por `created_at desc` do banco, então basta quebrar
 * quando o dia muda — não precisa reordenar nem estabilizar nada.
 */
function porDia(lista: Pedido[]): [string, Pedido[]][] {
  const grupos: [string, Pedido[]][] = [];
  for (const p of lista) {
    const d = diaDe(p.created_at) ?? "sem-data";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo[0] === d) ultimo[1].push(p);
    else grupos.push([d, [p]]);
  }
  return grupos;
}

/** Cancelado não conta no total do dia — não entrou dinheiro. */
function totalDoDia(lista: Pedido[]) {
  return lista
    .filter((p) => p.status !== "cancelado")
    .reduce((s, p) => s + (p.valor_total ?? 0), 0);
}

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
  onStatusChange: (id: string, newStatus: string, motivo?: string) => Promise<void>;
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
  const [updating, setUpdating] = useState(false);
  // Cancelar é irreversível pela tela e o botão fica colado no "avançar status":
  // sem esta confirmação, um toque errado tirava o pedido da fila sem aviso nenhum.
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
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

  async function advance(newStatus: string, motivo?: string) {
    setUpdating(true);
    await onStatusChange(p.id, newStatus, motivo);
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
            <CodigoPedido codigo={pedidoNumero(p)} className="block leading-tight" />
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
        <EnderecoLink endereco={p.endereco} className="flex gap-2" />
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
            <>
              <button
                disabled={updating}
                onClick={() => setConfirmarCancelar(true)}
                title="Cancelar pedido"
                aria-label="Cancelar pedido"
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-status-cancelado/10 text-status-cancelado hover:bg-status-cancelado/15 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>

              <AlertDialog
                open={confirmarCancelar}
                onOpenChange={(v) => { setConfirmarCancelar(v); if (!v) setMotivoCancelamento(""); }}
              >
                <AlertDialogContent onClick={pararPropagacao}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar o pedido {pedidoNumero(p)}? Por quê?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {nome}
                      {itens.length ? ` · ${itens.length} ${itens.length === 1 ? "item" : "itens"}` : ""}
                      {p.valor_total ? ` · ${brl(p.valor_total)}` : ""}.
                      <br />
                      O pedido sai da fila do balcão e não dá para desfazer por aqui.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <MotivoCancelamento value={motivoCancelamento} onChange={setMotivoCancelamento} />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => advance("cancelado", motivoCancelamento)}
                      disabled={!motivoCancelamento.trim()}
                      className="bg-status-cancelado text-white hover:bg-status-cancelado/90 disabled:opacity-50"
                    >
                      Cancelar pedido
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
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
  onConfirmarEntrega: (id: string) => Promise<boolean>;
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
  const locLink = despacho?.localizacao ? `https://maps.google.com/?q=${despacho.localizacao}` : null;

  const [confirming, setConfirming] = useState(false);

  async function handleConfirmar() {
    setConfirming(true);
    try {
      // false = abriu o modal de pagamento, ainda não confirmou de fato —
      // o toast de sucesso sai de lá quando o balcão terminar.
      const confirmou = await onConfirmarEntrega(p.id);
      if (confirmou) toast({ title: "Entrega confirmada!" });
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
            <CodigoPedido codigo={pedidoNumero(p)} className="block leading-tight" />
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
        <EnderecoLink endereco={p.endereco} className="flex gap-2" />

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
  const { toast } = useToast();
  const readOnly = role !== "admin";
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [entregadores, setEntregadores] = useState<EntregadorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtros, setFiltros] = useState<string[]>(STATUS_ATIVOS_DEFAULT);
  // Busca e dia valem para as quatro abas: é a mesma fila vista de ângulos
  // diferentes, e trocar de aba perdendo o que se estava procurando irrita.
  // `dia = null` significa "todos os dias" — é o padrão, senão o balcão abre a
  // tela achando que sumiram os pedidos de ontem que ainda estão na rua.
  const [busca, setBusca] = useState("");
  const [dia, setDia] = useState<string | null>(null);
  // Conversas saiu daqui e voltou a ser tela própria (/conversas), na seção
  // Atendimento — ver [AppLayout]. Quem chegar pelo link antigo `?aba=conversas`
  // é levado para lá em vez de cair num Kanban sem explicação.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const operador = useOperador();
  const [aba, setAba] = useState<"kanban" | "na_rua" | "agendados" | "historico">("kanban");

  useEffect(() => {
    if (searchParams.get("aba") === "conversas") navigate("/conversas", { replace: true });
  }, [searchParams, navigate]);
  const [agendados, setAgendados] = useState<PedidoAgendado[]>([]);
  const [despacharPedido, setDespacharPedido] = useState<Pedido | null>(null);
  // Confirmar entrega pelo balcão (Kanban ou "Na rua") sem o entregador ter
  // registrado nada ainda em `despacho_entrega` — abre este modal em vez de
  // fechar o pedido sem saber como foi pago.
  const [pagamentoPendente, setPagamentoPendente] = useState<Pedido | null>(null);
  const [confirmandoPagamento, setConfirmandoPagamento] = useState(false);
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
    const [{ data: pedidosData }, { data: entregadoresData }, { data: agendadosData }] = await Promise.all([
      externalSupabase
        .from("pedidos")
        .select(PEDIDO_SELECT)
        .order("created_at", { ascending: false }),
      externalSupabase.from("entregadores").select("*"),
      externalSupabase
        .from("pedidos_agendados")
        .select(AGENDADO_SELECT)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setPedidos((pedidosData as unknown as Pedido[]) ?? []);
    setEntregadores((entregadoresData as EntregadorFull[]) ?? []);
    setAgendados((agendadosData as unknown as PedidoAgendado[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  /**
   * Balcão puxa um agendado para frente sem esperar a resposta do cliente.
   *
   * Quem converte é o WF_Agendamento_Confirmar (cria pedido + itens, baixa o agendamento,
   * avisa o cliente e o grupo). Aqui só disparamos — reimplementar a conversão no painel
   * criaria a segunda cópia da regra, o erro que já aconteceu duas vezes neste arquivo.
   */
  async function confirmarAgendado(a: PedidoAgendado) {
    try {
      const r = await fetch("/api/agendamento-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendado_id: a.id,
          acao: "OK",
          telefone: a.telefone,
          nome: a.nome_cliente ?? "Cliente",
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      toast({
        title: "Pedido confirmado",
        description: "Entrou na fila do balcão e o cliente foi avisado no WhatsApp.",
      });
      // O webhook responde onReceived: a conversão termina logo depois da resposta.
      setTimeout(() => load(true), 2000);
    } catch (e) {
      toast({
        title: "Não deu para confirmar",
        description: e instanceof Error ? e.message : "Falha ao falar com o n8n.",
        variant: "destructive",
      });
    }
  }

  /**
   * Cancela um agendamento pelo balcão.
   *
   * Vai pelo MESMO webhook do confirmar, só que com `acao: "NAO"` — o ramo de
   * cancelamento já existe inteiro no WF_Agendamento_Confirmar (AGC_Cancelar
   * baixa a linha, AGC_Msg_Cancelado avisa o cliente no WhatsApp). Gravar
   * `status: 'cancelado'` direto daqui seria mais curto e deixaria o cliente sem
   * aviso nenhum — foi assim que o painel já divergiu do n8n três vezes.
   */
  async function cancelarAgendado(a: PedidoAgendado) {
    try {
      const r = await fetch("/api/agendamento-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendado_id: a.id,
          acao: "NAO",
          telefone: a.telefone,
          nome: a.nome_cliente ?? "Cliente",
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      toast({
        title: "Agendamento cancelado",
        description: "O cliente foi avisado no WhatsApp.",
      });
      setTimeout(() => load(true), 2000);
    } catch (e) {
      toast({
        title: "Não deu para cancelar",
        description: e instanceof Error ? e.message : "Falha ao falar com o n8n.",
        variant: "destructive",
      });
    }
  }

  /**
   * Envia a confirmação para o cliente — agora, não no próximo tique.
   *
   * Marca `liberado_em` (o portão que o WF_Agendamento_Liberar respeita) e em
   * seguida cutuca o webhook `agendamento-liberar`, que entra no MESMO fluxo do
   * Schedule: checa estoque, desvia para revisão manual quando falta item, manda
   * o option-list e grava `confirmacao_enviada_em`. O painel continua não
   * escrevendo a mensagem — seria a quarta cópia de regra do n8n neste arquivo.
   *
   * Antes só marcava `liberado_em` e o envio saía em até 5 minutos, o que fazia
   * o balcão clicar de novo achando que tinha falhado. O Schedule segue ativo
   * como rede de segurança: se o disparo imediato falhar, o tique pega depois —
   * por isso a falha aqui é um aviso, não um erro que desfaz a liberação.
   */
  async function liberarAgendado(a: PedidoAgendado) {
    const agora = new Date().toISOString();
    const { error } = await externalSupabase
      .from("pedidos_agendados")
      .update({ liberado_em: agora })
      .eq("id", a.id);

    if (error) {
      toast({
        title: "Não deu para liberar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setAgendados((prev) => prev.map((x) => (x.id === a.id ? { ...x, liberado_em: agora } : x)));

    try {
      const r = await fetch("/api/agendamento-liberar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendado_id: a.id }),
      });
      if (!r.ok) throw new Error(String(r.status));
      toast({
        title: "Confirmação enviada!",
        description: "O cliente já recebeu os botões de confirmar/cancelar no WhatsApp.",
      });
    } catch {
      toast({
        title: "Liberado, mas o envio imediato falhou",
        description: "O cliente ainda recebe no próximo ciclo automático (até 5 min).",
      });
    }
    setTimeout(() => load(true), 2500);
  }

  async function handleStatusChange(id: string, newStatus: string, motivo?: string) {
    // O card do Kanban também tem "Confirmar Entrega" (NEXT_NORMAL.saiu_para_entrega).
    // Sem este desvio ele fechava o pedido por fora: sem avisar o cliente e sem baixar
    // o despacho_entrega — só a aba "Na rua" fazia certo, com o mesmo rótulo de botão.
    if (newStatus === "entregue") {
      await iniciarConfirmarEntrega(id);
      return;
    }
    // Toda mudança feita na mão carimba quem fez: é o que separa o que a Maria
    // fechou sozinha do que o balcão moveu.
    const patch: Record<string, unknown> = { status: newStatus, ...operador };
    if (newStatus === "cancelado" && motivo) patch.motivo_cancelamento = motivo;
    await externalSupabase.from("pedidos").update(patch).eq("id", id);
    setPedidos((prev) => prev.map((p) => (p.id === id ? { ...p, status: newStatus } : p)));
  }

  /**
   * Se o entregador já registrou o pagamento pelo celular dele
   * (`despacho_entrega.pagamento_recebido`), confirma direto — perguntar de
   * novo só atrapalharia. Senão, abre o modal para o balcão registrar antes
   * de fechar o pedido. Retorna `true` quando já confirmou nesta chamada —
   * os cards usam isso para não mostrar "Entrega confirmada!" cedo demais,
   * enquanto o modal ainda está esperando o balcão preencher.
   */
  async function iniciarConfirmarEntrega(id: string): Promise<boolean> {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return false;
    if (pagamentoJaRegistrado(pedido)) {
      await handleConfirmarEntrega(id);
      return true;
    }
    setPagamentoPendente(pedido);
    return false;
  }

  async function handleConfirmarEntrega(id: string, pagamentos?: ItemPagamento[]) {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;
    const { avisouCliente } = await confirmarEntregaPedido(pedido, pagamentos ?? null, operador);
    setPedidos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "entregue" } : p)));
    if (!avisouCliente) {
      toast({
        title: "Cliente não foi avisado",
        description: "O status foi salvo, mas o WhatsApp não saiu.",
        variant: "destructive",
      });
    }
  }

  async function confirmarComPagamento(pagamentos: ItemPagamento[]) {
    if (!pagamentoPendente) return;
    setConfirmandoPagamento(true);
    await handleConfirmarEntrega(pagamentoPendente.id, pagamentos);
    setConfirmandoPagamento(false);
    setPagamentoPendente(null);
    toast({ title: "Entrega confirmada!" });
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Busca + dia aplicados uma vez; todas as abas leem daqui.
  const visiveis = pedidos.filter(
    (p) => (dia === null || diaDe(p.created_at) === dia) && casaBusca(textoBusca(p), busca),
  );
  const agendadosVisiveis = agendados.filter(
    (a) => (dia === null || diaDe(a.created_at) === dia) && casaBusca(textoBuscaAgendado(a), busca),
  );
  const filtrando = busca.trim() !== "" || dia !== null;

  /** Contagem por dia para os chips — respeita a busca, ignora o dia selecionado. */
  const contarNoDia = (d: string | null) =>
    pedidos.filter(
      (p) => (d === null || diaDe(p.created_at) === d) && casaBusca(textoBusca(p), busca),
    ).length;

  const byStatus = (status: string) => visiveis.filter((p) => p.status === status);
  const naRua = visiveis.filter((p) => p.status === "saiu_para_entrega");
  // Só os vivos entram no badge, e sobre a lista INTEIRA: o badge é alerta de
  // trabalho parado, não pode sumir só porque o balcão filtrou por "hoje".
  const agendadosPendentes = agendados.filter((a) => AGENDADO_PENDENTES.includes(a.status)).length;

  // O contador de conversas em espera saiu daqui junto com a aba: agora vive no
  // item "Conversas" da sidebar (AppLayout), que é onde o balcão vai clicar.
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

        {/* Abas — sem flex-wrap: no mobile, quebrar linha aqui empurrava os
            Cards pra fora da metade da tela. Rola de lado em vez de quebrar. */}
        <div className="flex gap-1 overflow-x-auto">
          <button
            onClick={() => setAba("kanban")}
            className={cn(
              "shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              aba === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            Kanban
          </button>

          <button
            onClick={() => setAba("na_rua")}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
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
          {/* Com pendência, a aba ganha borda e fundo âmbar em vez de ficar cinza
              no meio da fileira — é trabalho parado que ninguém vê no Kanban. */}
          <button
            onClick={() => setAba("agendados")}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border",
              aba === "agendados"
                ? "bg-status-separacao text-white border-transparent"
                : agendadosPendentes > 0
                  ? "bg-status-separacao/10 text-status-ink-separacao border-status-separacao/40"
                  : "text-muted-foreground border-transparent hover:bg-secondary",
            )}
          >
            <AlarmClock className="w-4 h-4" />
            Agendados
            {agendadosPendentes > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-xs font-bold",
                aba === "agendados" ? "bg-white/20 text-white" : "bg-status-separacao text-white animate-pulse"
              )}>
                {agendadosPendentes}
              </span>
            )}
          </button>
          <button
            onClick={() => setAba("historico")}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              aba === "historico" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <History className="w-4 h-4" />
            Histórico
          </button>
        </div>

        {/* Busca + dia — valem para todas as abas de pedido. */}
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código, cliente, telefone, endereço ou item..."
              className="w-full h-10 pl-9 pr-9 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <FiltroData dia={dia} onChange={setDia} contar={contarNoDia} />

          {/* Sem este aviso, um filtro esquecido vira "sumiram os pedidos". */}
          {filtrando && (
            <button
              onClick={() => { setBusca(""); setDia(null); }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <X className="w-3.5 h-3.5" />
              Limpar filtros — mostrando {visiveis.length} de {pedidos.length} pedidos
            </button>
          )}
        </div>
      </div>

      {/* ── ABA KANBAN ── */}
      {aba === "kanban" && (
        <>
          {/* Agendado é o único trabalho que NÃO aparece no Kanban: fica numa aba
              ao lado e some da vista. Já aconteceu de pedido agendado dormir a
              manhã inteira esperando alguém lembrar de abrir a aba. Este aviso é
              a ponte — some sozinho quando não há pendência. */}
          {agendadosPendentes > 0 && (
            <button
              onClick={() => setAba("agendados")}
              className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-2.5 rounded-xl border border-status-separacao/40 bg-status-separacao/10 px-3 py-2.5 text-left transition-colors hover:bg-status-separacao/20"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-separacao text-white">
                <AlarmClock className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-status-ink-separacao">
                  {agendadosPendentes}{" "}
                  {agendadosPendentes === 1 ? "pedido agendado esperando" : "pedidos agendados esperando"}
                </span>
                <span className="block text-xs text-status-ink-separacao/80">
                  Toque para abrir e enviar a confirmação ao cliente
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-status-ink-separacao" />
            </button>
          )}

          {/* Filtros — sem flex-wrap pelo mesmo motivo das Abas: no mobile,
              5 chips quebravam pra uma 2ª linha e comiam a altura dos Cards. */}
          <div className="px-4 pb-3 pt-3 flex gap-2 overflow-x-auto">
            {COLUNAS.map((col) => (
              <button
                key={col.status}
                onClick={() => toggleFiltro(col.status)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
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
          {/* min-h-0 é o que faz este flex item PARAR de crescer pra caber o
              conteúdo — sem ele, a coluna interna (com sua própria rolagem)
              ficava livre pra passar da altura real da tela, e o overflow-y-hidden
              aqui cortava o resto do card fora sem dar pra rolar até lá. Antes
              disso a coluna usava max-h-[calc(100vh-260px)]: um número mágico que
              já supunha 260px de cabeçalho (errado assim que o header ganha mais
              uma linha, principalmente no mobile) e ainda usava vh, que no celular
              conta a área atrás da barra de endereço como visível. */}
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
            <div className="flex gap-4 p-4 h-full" style={{ minWidth: "max-content" }}>
              {COLUNAS.filter((col) => filtros.includes(col.status)).map((col) => {
                const items = byStatus(col.status);
                return (
                  <div key={col.status} className="flex-shrink-0 w-72 sm:w-80 h-full flex flex-col gap-3">
                    <div className={cn("shrink-0 flex items-center justify-between px-4 py-2.5 rounded-xl", col.bgLight)}>
                      <span className={cn("font-bold text-base flex items-center gap-1.5", col.text)}><col.Icon className="w-4 h-4 shrink-0" />{col.label}</span>
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", col.badge)}>{items.length}</span>
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto pr-0.5">
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
              <p className="text-sm">
                {filtrando ? "Nenhum pedido em trânsito com esses filtros" : "Nenhum pedido em trânsito agora"}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {naRua.map((p) => (
                <NaRuaCard
                  key={p.id}
                  p={p}
                  entregadores={entregadores}
                  onConfirmarEntrega={iniciarConfirmarEntrega}
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
      {/* ── ABA AGENDADOS ── */}
      {aba === "agendados" && (
        <div className="flex-1 overflow-y-auto">
          <AgendadosLista
            agendados={agendadosVisiveis}
            onAbrirPedido={(id) => { setFichaId(id); setAba("kanban"); }}
            onConfirmar={readOnly ? undefined : confirmarAgendado}
            onLiberar={readOnly ? undefined : liberarAgendado}
            onCancelar={readOnly ? undefined : cancelarAgendado}
          />
        </div>
      )}

      {aba === "historico" && (
        <div className="flex-1 overflow-y-auto p-4">
          {visiveis.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
              <History className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {filtrando ? "Nenhum pedido com esses filtros" : "Nenhum pedido registrado"}
              </p>
            </div>
          ) : (
            <div className="space-y-5 max-w-3xl mx-auto">
              {porDia(visiveis).map(([diaIso, doDia]) => (
                <section key={diaIso}>
                  {/* Cabeçalho grudento: rolando uma lista longa, o balcão perde
                      a noção de qual dia está olhando. */}
                  <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-background/95 backdrop-blur flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-extrabold text-foreground capitalize">
                      {rotuloDia(diaIso)}
                    </h2>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {doDia.length} {doDia.length === 1 ? "pedido" : "pedidos"} ·{" "}
                      <span className={moneyClass(totalDoDia(doDia))}>{brl(totalDoDia(doDia))}</span>
                    </span>
                  </div>

                  <div className="space-y-2 mt-1.5">
              {doDia.map((p) => {
                const cfg = statusConfig(p.status);
                // Quem levou. O despacho guarda só o id; o nome vem da lista de
                // entregadores (que inclui os desativados, senão pedido antigo
                // ficaria sem nome nenhum).
                const despachoHist = p.despacho_entrega?.[0] ?? null;
                const entregadorHist = despachoHist?.entregador_id
                  ? entregadores.find((e) => e.id === despachoHist.entregador_id) ?? null
                  : null;
                const telHist = formatPhone(p.clientes?.telefone);
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
                      <div className="flex items-baseline gap-2 min-w-0">
                        <CodigoPedido codigo={pedidoNumero(p)} tamanho="sm" className="shrink-0" />
                        <p className="text-sm font-semibold text-foreground truncate">
                          {p.clientes?.nome ?? p.clientes?.telefone ?? "—"}
                        </p>
                        {/* O nome sozinho não identifica: há homônimo e há cliente
                            salvo só pelo telefone. */}
                        {p.clientes?.nome && telHist && (
                          <span className="text-xs text-muted-foreground shrink-0">{telHist}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {/* Só a hora: o dia já está no cabeçalho do grupo. */}
                        {p.created_at ? format(new Date(p.created_at), "HH:mm", { locale: ptBR }) : "—"}
                      </p>
                      {/* Endereço e entregador: sem eles, achar "o pedido daquela
                          rua" ou "o que fulano levou" obrigava a abrir um por um. */}
                      {p.tipo_fulfillment === "retirada" ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Package className="w-3 h-3 shrink-0" />
                          Retirada na loja
                        </p>
                      ) : p.endereco ? (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                          <Navigation className="w-3 h-3 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{p.endereco}</span>
                        </p>
                      ) : null}
                      {entregadorHist && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Truck className="w-3 h-3 shrink-0" />
                          <span className="truncate">{entregadorHist.nome}</span>
                        </p>
                      )}
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
                </section>
              ))}
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

      <ConfirmarPagamentoModal
        open={!!pagamentoPendente}
        onClose={() => setPagamentoPendente(null)}
        valorEsperado={pagamentoPendente?.valor_total}
        pending={confirmandoPagamento}
        onConfirmar={confirmarComPagamento}
        titulo="Como foi pago?"
        confirmLabel="Confirmar entrega"
      />
    </div>
  );
}
