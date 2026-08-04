import { useState } from "react";
import { AlarmClock, AlertTriangle, Ban, CheckCircle2, Clock, Loader2, MessageCircle, Timer } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl, moneyClass } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Pedidos agendados — os que o cliente montou com a farmácia fechada e ainda não viraram
 * pedido de verdade. Tabela `pedidos_agendados`, escrita pelos workflows WF_Agendamento_*.
 *
 * O caminho normal é pelo WhatsApp: o WF_Agendamento_Liberar manda os botões ao cliente na
 * abertura e ele confirma. O balcão acompanha por aqui e pode **puxar o pedido para frente**
 * sem esperar o cliente, pelo botão "Confirmar agora" — o cliente é avisado depois.
 *
 * A conversão não é feita aqui: o botão chama `/api/agendamento-confirmar`, que repassa ao
 * WF_Agendamento_Confirmar do n8n, onde a regra já existe inteira.
 */

export type ItemAgendado = { name: string; quantity: number; price?: number };

export type PedidoAgendado = {
  id: string;
  codigo: string | null;
  cliente_id: string;
  telefone: string;
  nome_cliente: string | null;
  itens: ItemAgendado[] | string;
  resumo: string | null;
  tipo_fulfillment: string;
  endereco: string | null;
  pagamento: string | null;
  valor_total: number | null;
  status: string;
  motivo: string | null;
  pedido_id: string | null;
  abre_em: string | null;
  confirmacao_enviada_em: string | null;
  respondido_em: string | null;
  created_at: string;
};

export const AGENDADO_SELECT =
  "id,codigo,cliente_id,telefone,nome_cliente,itens,resumo,tipo_fulfillment,endereco," +
  "pagamento,valor_total,status,motivo,pedido_id,abre_em,confirmacao_enviada_em,respondido_em,created_at";

/** Ainda vivos: é o que o balcão precisa acompanhar. O resto é histórico. */
export const AGENDADO_PENDENTES = ["aguardando_abertura", "aguardando_confirmacao", "revisao_manual"];

type Cfg = { label: string; Icon: typeof Clock; chip: string; faixa: string; ajuda: string };

const CFG: Record<string, Cfg> = {
  aguardando_abertura: {
    label: "Aguardando abertura",
    Icon: AlarmClock,
    chip: "bg-status-separacao/10 text-status-ink-separacao border border-status-separacao/30",
    faixa: "bg-status-separacao",
    ajuda: "Na fila. Quando a farmácia abrir, a Ana chama o cliente para confirmar.",
  },
  aguardando_confirmacao: {
    label: "Esperando o cliente",
    Icon: Timer,
    chip: "bg-status-novo/10 text-status-ink-novo border border-status-novo/30",
    faixa: "bg-status-novo",
    ajuda: "Já mandamos os botões no WhatsApp. Aguardando o cliente confirmar.",
  },
  revisao_manual: {
    label: "Precisa de ajuste",
    Icon: AlertTriangle,
    chip: "bg-status-cancelado/10 text-status-ink-cancelado border border-status-cancelado/30",
    faixa: "bg-status-cancelado",
    ajuda: "Faltou item no estoque. O cliente já foi avisado — alguém precisa falar com ele.",
  },
  confirmado: {
    label: "Virou pedido",
    Icon: CheckCircle2,
    chip: "bg-status-entregue/10 text-status-ink-entregue border border-status-entregue/30",
    faixa: "bg-status-entregue",
    ajuda: "O cliente confirmou e o pedido entrou na fila do balcão.",
  },
  cancelado: {
    label: "Cancelado",
    Icon: Ban,
    chip: "bg-secondary text-muted-foreground",
    faixa: "bg-muted-foreground/40",
    ajuda: "O cliente cancelou na hora de confirmar.",
  },
  expirado: {
    label: "Sem resposta",
    Icon: Clock,
    chip: "bg-secondary text-muted-foreground",
    faixa: "bg-muted-foreground/40",
    ajuda: "O cliente não respondeu dentro da janela de confirmação.",
  },
};

const cfgDe = (s: string): Cfg =>
  CFG[s] ?? { label: s, Icon: Clock, chip: "bg-secondary text-muted-foreground", faixa: "bg-muted-foreground/40", ajuda: "" };

export function itensDe(a: PedidoAgendado): ItemAgendado[] {
  if (Array.isArray(a.itens)) return a.itens;
  try {
    const p = JSON.parse(a.itens || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

const hora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : null;

function Card({
  a,
  onAbrirPedido,
  onConfirmar,
}: {
  a: PedidoAgendado;
  onAbrirPedido?: (id: string) => void;
  onConfirmar?: (a: PedidoAgendado) => Promise<void>;
}) {
  const cfg = cfgDe(a.status);
  const itens = itensDe(a);
  const tel = (a.telefone || "").replace(/\D/g, "");
  const [perguntando, setPerguntando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const podeConfirmar = !!onConfirmar && AGENDADO_PENDENTES.includes(a.status);

  async function confirmar() {
    setConfirmando(true);
    try {
      await onConfirmar!(a);
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <span className={cn("absolute left-0 top-0 bottom-0 w-1.5", cfg.faixa)} aria-hidden />

      <div className="pl-5 pr-4 py-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {a.codigo && (
                <span className="font-mono text-sm font-bold text-foreground">{a.codigo}</span>
              )}
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold", cfg.chip)}>
                <cfg.Icon className="w-3.5 h-3.5 shrink-0" />
                {cfg.label}
              </span>
            </div>
            <p className="mt-1 font-semibold text-foreground truncate">{a.nome_cliente || "Sem nome"}</p>
          </div>

          {a.valor_total ? (
            <span className={cn("shrink-0 font-bold", moneyClass(a.valor_total))}>{brl(a.valor_total)}</span>
          ) : null}
        </div>

        <ul className="text-sm text-muted-foreground space-y-0.5 mb-2">
          {itens.length === 0 && <li className="italic">sem itens registrados</li>}
          {itens.map((i, idx) => (
            <li key={idx}>
              {i.quantity || 1}x {i.name}
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          {a.tipo_fulfillment === "retirada" ? "🏪 Retirada na loja" : `🚚 ${a.endereco || "sem endereço"}`}
          {a.pagamento ? ` · 💳 ${a.pagamento}` : ""}
        </p>

        {a.motivo && (
          <p className="mt-2 text-xs font-semibold text-status-ink-cancelado">{a.motivo}</p>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          Agendado {hora(a.created_at)}
          {a.confirmacao_enviada_em ? ` · avisado ${hora(a.confirmacao_enviada_em)}` : ""}
          {a.respondido_em ? ` · respondeu ${hora(a.respondido_em)}` : ""}
        </p>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {tel && (
            <a
              href={`https://wa.me/${tel}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-secondary text-sm font-semibold text-foreground hover:bg-secondary/70 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
          {a.pedido_id && onAbrirPedido && (
            <button
              onClick={() => onAbrirPedido(a.pedido_id!)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary/10 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              Ver pedido gerado
            </button>
          )}

          {podeConfirmar && (
            <>
              <button
                onClick={() => setPerguntando(true)}
                disabled={confirmando}
                className={cn(
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors",
                  confirmando && "opacity-60 cursor-not-allowed"
                )}
              >
                {confirmando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmar agora
              </button>

              <AlertDialog open={perguntando} onOpenChange={setPerguntando}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmar o agendamento {a.codigo ?? ""}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {a.nome_cliente || "Cliente"}
                      {itens.length ? ` · ${itens.length} ${itens.length === 1 ? "item" : "itens"}` : ""}
                      {a.valor_total ? ` · ${brl(a.valor_total)}` : ""}.
                      <br />
                      O pedido entra na fila do balcão agora e o cliente recebe o aviso de
                      confirmação no WhatsApp, sem precisar responder.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmar}>Confirmar pedido</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgendadosLista({
  agendados,
  onAbrirPedido,
  onConfirmar,
}: {
  agendados: PedidoAgendado[];
  onAbrirPedido?: (pedidoId: string) => void;
  onConfirmar?: (a: PedidoAgendado) => Promise<void>;
}) {
  const pendentes = agendados.filter((a) => AGENDADO_PENDENTES.includes(a.status));
  const encerrados = agendados.filter((a) => !AGENDADO_PENDENTES.includes(a.status));

  if (agendados.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <AlarmClock className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="font-semibold text-foreground">Nenhum pedido agendado</p>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          Quando um cliente montar um pedido com a farmácia fechada, ele aparece aqui até ser
          confirmado na abertura.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {pendentes.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-foreground mb-2">
            Na fila <span className="text-muted-foreground font-semibold">({pendentes.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pendentes.map((a) => (
              <Card key={a.id} a={a} onAbrirPedido={onAbrirPedido} onConfirmar={onConfirmar} />
            ))}
          </div>
        </section>
      )}

      {encerrados.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-muted-foreground mb-2">
            Encerrados <span className="font-semibold">({encerrados.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 opacity-75">
            {encerrados.map((a) => (
              <Card key={a.id} a={a} onAbrirPedido={onAbrirPedido} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
