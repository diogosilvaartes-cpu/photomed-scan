import { useState } from "react";
import { AlarmClock, AlertTriangle, Ban, CheckCircle2, Clock, Loader2, MessageCircle, Send, Timer, Truck } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl, moneyClass } from "@/lib/status";
import { cn } from "@/lib/utils";
import CodigoPedido from "@/components/CodigoPedido";
import EnderecoLink from "@/components/EnderecoLink";

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
  /** Quando o balcão liberou para o cliente confirmar. NULL = o n8n ignora. */
  liberado_em: string | null;
  confirmacao_enviada_em: string | null;
  respondido_em: string | null;
  created_at: string;
};

export const AGENDADO_SELECT =
  "id,codigo,cliente_id,telefone,nome_cliente,itens,resumo,tipo_fulfillment,endereco," +
  "pagamento,valor_total,status,motivo,pedido_id,abre_em,liberado_em,confirmacao_enviada_em,respondido_em,created_at";

/** Ainda vivos: é o que o balcão precisa acompanhar. O resto é histórico.
 * `aguardando_entrega` é o irmão de `aguardando_abertura` — nasce quando o
 * pedido chega com a entrega desligada (farmácia aberta), ver
 * AGENDAMENTO/09_agendar_sem_entrega.js. Faltar aqui derruba os botões do
 * card pra seção Encerrados mesmo com o agendamento ainda vivo. */
export const AGENDADO_PENDENTES = ["aguardando_abertura", "aguardando_entrega", "aguardando_confirmacao", "revisao_manual"];

type Cfg = { label: string; Icon: typeof Clock; chip: string; faixa: string; ajuda: string };

const CFG: Record<string, Cfg> = {
  aguardando_abertura: {
    label: "Represado",
    Icon: AlarmClock,
    chip: "bg-status-separacao/10 text-status-ink-separacao border border-status-separacao/30",
    faixa: "bg-status-separacao",
    ajuda: "Na fila. O cliente só é chamado quando o balcão liberar.",
  },
  aguardando_confirmacao: {
    label: "Esperando o cliente",
    Icon: Timer,
    chip: "bg-status-novo/10 text-status-ink-novo border border-status-novo/30",
    faixa: "bg-status-novo",
    ajuda: "Já mandamos os botões no WhatsApp. Aguardando o cliente confirmar.",
  },
  aguardando_entrega: {
    label: "Esperando a entrega voltar",
    Icon: Truck,
    chip: "bg-status-separacao/10 text-status-ink-separacao border border-status-separacao/30",
    faixa: "bg-status-separacao",
    ajuda: "Farmácia aberta, mas a entrega está desligada. O cliente é chamado assim que ela voltar.",
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
  onLiberar,
  onCancelar,
}: {
  a: PedidoAgendado;
  onAbrirPedido?: (id: string) => void;
  onConfirmar?: (a: PedidoAgendado) => Promise<void>;
  onLiberar?: (a: PedidoAgendado) => Promise<void>;
  onCancelar?: (a: PedidoAgendado) => Promise<void>;
}) {
  const cfg = cfgDe(a.status);
  const itens = itensDe(a);
  const tel = (a.telefone || "").replace(/\D/g, "");
  const [perguntando, setPerguntando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [perguntandoCancelar, setPerguntandoCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const podeConfirmar = !!onConfirmar && AGENDADO_PENDENTES.includes(a.status);
  // Mesma janela do confirmar: enquanto o agendamento estiver vivo, o balcão
  // pode desfazer. Depois de virar pedido, quem cancela é a fila (aba Kanban).
  const podeCancelar = !!onCancelar && AGENDADO_PENDENTES.includes(a.status);
  // Liberar é o passo ANTES de confirmar: manda os botões ao cliente e deixa
  // ele decidir. Só faz sentido enquanto ninguém foi chamado ainda.
  const podeLiberar =
    !!onLiberar && !a.liberado_em && ["aguardando_abertura", "aguardando_entrega"].includes(a.status);
  const esperandoEnvio = !!a.liberado_em && !a.confirmacao_enviada_em && a.status !== "confirmado";

  async function confirmar() {
    setConfirmando(true);
    try {
      await onConfirmar!(a);
    } finally {
      setConfirmando(false);
    }
  }

  async function liberar() {
    setLiberando(true);
    try {
      await onLiberar!(a);
    } finally {
      setLiberando(false);
    }
  }

  async function cancelar() {
    setCancelando(true);
    try {
      await onCancelar!(a);
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <span className={cn("absolute left-0 top-0 bottom-0 w-1.5", cfg.faixa)} aria-hidden />

      <div className="pl-5 pr-4 py-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CodigoPedido codigo={a.codigo} />
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

        <div className="text-xs text-muted-foreground">
          {a.tipo_fulfillment === "retirada" ? (
            <span>🏪 Retirada na loja</span>
          ) : a.endereco ? (
            <span className="inline-flex items-start gap-1">
              🚚 <EnderecoLink endereco={a.endereco} icone={false} className="text-xs" />
            </span>
          ) : (
            <span>🚚 sem endereço</span>
          )}
          {a.pagamento ? ` · 💳 ${a.pagamento}` : ""}
        </div>

        {a.motivo && (
          <p className="mt-2 text-xs font-semibold text-status-ink-cancelado">{a.motivo}</p>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          Agendado {hora(a.created_at)}
          {a.liberado_em ? ` · liberado ${hora(a.liberado_em)}` : ""}
          {a.confirmacao_enviada_em ? ` · avisado ${hora(a.confirmacao_enviada_em)}` : ""}
          {a.respondido_em ? ` · respondeu ${hora(a.respondido_em)}` : ""}
        </p>

        {/* O envio agora é disparado na hora pelo botão (webhook
            `agendamento-liberar`). Este aviso ficou para o caso de o disparo
            imediato falhar: o Schedule de 5 min é a rede de segurança e pega o
            agendamento no tique seguinte. */}
        {esperandoEnvio && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-status-ink-separacao bg-status-separacao/10 border border-status-separacao/25 rounded-lg px-2.5 py-1.5">
            <Timer className="w-3.5 h-3.5 shrink-0 mt-px" />
            Enviando… se não chegar agora, o cliente recebe no próximo ciclo (até 5 min).
          </p>
        )}

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

          {podeLiberar && (
            <button
              onClick={liberar}
              disabled={liberando}
              title="Envia agora os botões CONFIRMAR / CANCELAR no WhatsApp do cliente"
              className={cn(
                "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors",
                liberando && "opacity-60 cursor-not-allowed",
              )}
            >
              {liberando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar confirmação pro cliente
            </button>
          )}

          {podeConfirmar && (
            <>
              <button
                onClick={() => setPerguntando(true)}
                disabled={confirmando}
                title="Pula o cliente: põe o pedido na fila do balcão e avisa depois"
                className={cn(
                  // Deliberadamente mais discreto que "Pedir confirmação": o caminho
                  // normal é o cliente decidir; puxar por cima dele é a exceção.
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-secondary border border-border text-sm font-bold text-foreground hover:bg-secondary/70 transition-colors",
                  confirmando && "opacity-60 cursor-not-allowed"
                )}
              >
                {confirmando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmar sem perguntar
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

          {podeCancelar && (
            <>
              <button
                onClick={() => setPerguntandoCancelar(true)}
                disabled={cancelando || confirmando}
                title="Cancelar o agendamento e avisar o cliente"
                aria-label="Cancelar agendamento"
                className={cn(
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-status-cancelado/10 text-sm font-bold text-status-ink-cancelado hover:bg-status-cancelado/20 transition-colors",
                  cancelando && "opacity-60 cursor-not-allowed",
                )}
              >
                {cancelando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                Cancelar
              </button>

              <AlertDialog open={perguntandoCancelar} onOpenChange={setPerguntandoCancelar}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar o agendamento {a.codigo ?? ""}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {a.nome_cliente || "Cliente"}
                      {itens.length ? ` · ${itens.length} ${itens.length === 1 ? "item" : "itens"}` : ""}
                      {a.valor_total ? ` · ${brl(a.valor_total)}` : ""}.
                      <br />
                      O agendamento sai da fila e o cliente recebe no WhatsApp o aviso de
                      que foi cancelado. Não dá para desfazer por aqui.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={cancelar}
                      className="bg-status-cancelado text-white hover:bg-status-cancelado/90"
                    >
                      Cancelar agendamento
                    </AlertDialogAction>
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
  onLiberar,
  onCancelar,
}: {
  agendados: PedidoAgendado[];
  onAbrirPedido?: (pedidoId: string) => void;
  onConfirmar?: (a: PedidoAgendado) => Promise<void>;
  onLiberar?: (a: PedidoAgendado) => Promise<void>;
  onCancelar?: (a: PedidoAgendado) => Promise<void>;
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
              <Card
                key={a.id}
                a={a}
                onAbrirPedido={onAbrirPedido}
                onConfirmar={onConfirmar}
                onLiberar={onLiberar}
                onCancelar={onCancelar}
              />
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
