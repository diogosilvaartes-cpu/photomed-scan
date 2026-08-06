import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useToast } from "@/hooks/use-toast";
import { useOperador } from "@/lib/operador";
import {
  Phone, MapPin, CreditCard, Package, Truck, Clock, CheckCircle, Navigation,
  LocateFixed, StickyNote, User, Hash, Camera, Link2, ChevronRight, Compass, Ban, ZoomIn,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { statusConfig, brl, moneyClass } from "@/lib/status";
import CodigoPedido from "@/components/CodigoPedido";
import EnderecoLink from "@/components/EnderecoLink";
import ImageLightbox from "@/components/ImageLightbox";
import MotivoCancelamento from "@/components/MotivoCancelamento";
import {
  type Pedido, type EntregadorFull,
  formatPhone, fotoWhatsApp, itensValidos, mapsLink, pedidoNumero, timeAgo,
} from "@/lib/pedido";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Grupo Balcão no WhatsApp — mesmo ID usado pelos workflows do n8n. */
const GRUPO_BALCAO = "120363412345233268-group";

/**
 * Ficha completa do pedido — o mesmo resumo que vai para o entregador,
 * em formato de card expandido. Abre ao clicar em qualquer card da fila.
 *
 * Quase toda ação continua nos cards; a exceção é o CANCELAMENTO, que precisa
 * estar aqui porque a ficha é a única tela aberta por link (`/pedido/:codigo`)
 * — quem recebe o link do pedido não tem a fila na frente.
 */

function dataHora(iso: string | null | undefined) {
  if (!iso) return null;
  return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

function hora(iso: string | null | undefined) {
  if (!iso) return null;
  return format(new Date(iso), "HH:mm", { locale: ptBR });
}

function Secao({
  titulo,
  Icon,
  children,
}: {
  titulo: string;
  Icon: typeof Package;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
        <Icon className="w-3.5 h-3.5" />
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground shrink-0">{rotulo}</span>
      <span className="text-right font-medium text-foreground break-words min-w-0">{children}</span>
    </div>
  );
}

export default function FichaPedido({
  pedido,
  entregadores,
  open,
  onClose,
}: {
  pedido: Pedido;
  entregadores: EntregadorFull[];
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  /**
   * Referência e fotos do LOCAL — as notas que o entregador deixou e que valem
   * para toda entrega futura naquele endereço (`enderecos.referencia` / `.fotos`).
   *
   * Vem por busca separada porque exige join com `enderecos`, que o
   * `PEDIDO_SELECT` não faz: `pedidos.endereco` guarda só o texto. Era por isso
   * que a referência **só existia no WhatsApp** (o `Desp_Montar_Msg` faz o join)
   * e nunca aparecia na ficha do painel.
   */
  const [local, setLocal] = useState<{
    referencia: string | null;
    fotos: string[] | null;
    latitude: number | null;
    longitude: number | null;
  } | null>(null);

  useEffect(() => {
    if (!open || !pedido.cliente_id) { setLocal(null); return; }
    if (!pedido.endereco_id && !pedido.endereco) { setLocal(null); return; }
    let vivo = true;
    (async () => {
      // `endereco_id` primeiro: o casamento por texto exato falhava sempre que a
      // grafia mudava ("Rua X, 10" vs "rua x 10") e a referência do local sumia
      // da ficha. O texto continua como fallback para os pedidos antigos, que
      // nasceram antes da coluna existir.
      const q = externalSupabase
        .from("enderecos")
        .select("referencia, fotos, latitude, longitude");
      const { data } = pedido.endereco_id
        ? await q.eq("id", pedido.endereco_id).limit(1)
        : await q.eq("cliente_id", pedido.cliente_id).eq("label_exibicao", pedido.endereco!).limit(1);
      if (vivo) setLocal(data?.[0] ?? null);
    })();
    return () => { vivo = false; };
  }, [open, pedido.cliente_id, pedido.endereco, pedido.endereco_id]);

  const { toast } = useToast();
  const qc = useQueryClient();
  const operador = useOperador();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");

  // Pedido já entregue ou já cancelado não volta atrás por aqui: desfazer baixa
  // é decisão de balcão, não de um clique numa ficha aberta por link.
  const podeCancelar = pedido.status !== "cancelado" && pedido.status !== "entregue";

  const cancelarPedido = useMutation({
    mutationFn: async () => {
      const { error } = await externalSupabase
        .from("pedidos")
        .update({ status: "cancelado", motivo_cancelamento: motivo.trim(), ...operador })
        .eq("id", pedido.id);
      if (error) throw error;

      // Baixa as duas pontas: quem olha o Kanban lê `pedidos.status` e quem olha o
      // monitor de entregas lê `despacho_entrega.status_entrega` — mexer só em uma
      // deixa a outra tela mentindo.
      if (pedido.despacho_entrega?.length) {
        await externalSupabase
          .from("despacho_entrega")
          .update({ status_entrega: "cancelado" })
          .eq("pedido_id", pedido.id);
      }

      // Aviso ao Balcão é parte do cancelamento, mas não pode derrubá-lo: se o
      // WhatsApp falhar, o pedido já está cancelado e o grupo vê na fila.
      try {
        await fetch("/api/notify-client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: GRUPO_BALCAO,
            message:
              `🚫 *PEDIDO CANCELADO* ${pedido.codigo ?? ""}\n\n` +
              `👤 ${pedido.clientes?.nome ?? "Sem nome"}\n` +
              (pedido.clientes?.telefone ? `📱 https://wa.me/${pedido.clientes.telefone.replace(/\D/g, "")}\n` : "") +
              `📝 Motivo: ${motivo.trim()}\n\n` +
              `_Cancelado pelo painel. O cliente NÃO foi avisado — falem com ele._`,
          }),
        });
      } catch {
        /* silencioso de propósito: ver comentário acima */
      }
    },
    onSuccess: () => {
      toast({
        title: "Pedido cancelado",
        description: "O grupo Balcão foi avisado. O cliente não recebeu nada — falem com ele.",
      });
      setCancelando(false);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["pedidos-cliente"] });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Não deu para cancelar", description: e.message, variant: "destructive" }),
  });

  const cfg = statusConfig(pedido.status);
  const itens = itensValidos(pedido);
  const despacho = pedido.despacho_entrega?.[0] ?? null;
  const entregador = despacho?.entregador_id
    ? entregadores.find((e) => e.id === despacho.entregador_id) ?? null
    : null;
  const phone = formatPhone(pedido.clientes?.telefone);
  const nome = pedido.clientes?.nome ?? "Cliente";
  const fotos = despacho?.fotos?.filter(Boolean) ?? [];
  // `foto_url` costuma vir vazia ou com link expirado — o proxy é o fallback.
  const avatar = pedido.clientes?.foto_url?.trim() || fotoWhatsApp(pedido.clientes?.telefone);

  // despacho é a fonte quando o entregador registrou pelo celular dele;
  // pedido.pagamento_recebido é o que o balcão registra ao confirmar pelo
  // Kanban/"Na rua" quando ninguém tinha registrado ainda.
  const recebido = despacho?.pagamento_recebido ?? pedido.pagamento_recebido ?? [];
  const totalRecebido = recebido.reduce((s, pg) => s + (pg.valor ?? 0), 0);

  const timeline: { rotulo: string; iso: string | null; Icon: typeof Clock; cor?: string }[] = [
    { rotulo: "Pedido criado", iso: pedido.created_at, Icon: Clock },
    { rotulo: "Despachado", iso: despacho?.enviado_em ?? null, Icon: Truck },
    { rotulo: "Saiu para entrega", iso: despacho?.saiu_em ?? null, Icon: Navigation },
    { rotulo: "Chegou no cliente", iso: despacho?.chegou_em ?? null, Icon: MapPin },
    {
      rotulo: "Entregue",
      iso: despacho?.entregue_em ?? null,
      Icon: CheckCircle,
      cor: "text-status-ink-entregue",
    },
  ].filter((t) => t.iso);

  /** A página Clientes já abre o drawer sozinha quando recebe `?id=`. */
  function abrirFichaCliente() {
    if (!pedido.cliente_id) return;
    onClose();
    navigate(`/clientes?id=${pedido.cliente_id}`);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold",
              cfg.pill,
            )}>
              <cfg.Icon className="w-3.5 h-3.5" />
              {cfg.label}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Hash className="w-4 h-4" />
              <CodigoPedido codigo={pedidoNumero(pedido)} tamanho="lg" />
            </span>
            {pedido.created_at && (
              <span className="text-xs text-muted-foreground">
                {dataHora(pedido.created_at)} · há {timeAgo(pedido.created_at)}
              </span>
            )}
          </div>
          <DialogTitle className="text-xl">{nome}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Cliente — o bloco todo leva para a ficha do cliente (histórico,
              endereços, anotações). O link do WhatsApp fica fora do botão para
              não disparar a navegação junto. */}
          <Secao titulo="Cliente" Icon={User}>
            <div className="flex items-center gap-3">
              <button
                onClick={abrirFichaCliente}
                disabled={!pedido.cliente_id}
                className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg -m-1 p-1 hover:bg-secondary disabled:hover:bg-transparent transition-colors"
                title={pedido.cliente_id ? "Abrir ficha do cliente" : undefined}
              >
                {avatar && (
                  <img
                    src={avatar}
                    alt=""
                    className="w-11 h-11 rounded-full object-cover border border-border shrink-0"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground truncate">{nome}</span>
                  {pedido.cliente_id && (
                    <span className="block text-xs text-muted-foreground">Ver ficha completa</span>
                  )}
                </span>
                {pedido.cliente_id && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>
            </div>
            {phone ? (
              <a
                href={`https://wa.me/55${phone}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 mt-2"
              >
                <Phone className="w-3.5 h-3.5" />
                {phone}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Sem telefone</p>
            )}

            {/* Nota que o entregador deixou sobre o cliente. Já ia no bilhete do
                WhatsApp desde 04/08, mas não aparecia em lugar nenhum do painel —
                o balcão não tinha como saber o que a rua já sabia. */}
            {pedido.clientes?.anotacoes_entregador && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-status-separacao/10 border border-status-separacao/25 px-3 py-2">
                <StickyNote className="w-4 h-4 shrink-0 mt-0.5 text-status-ink-separacao" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-status-ink-separacao">
                    Nota do entregador
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-line">
                    {pedido.clientes.anotacoes_entregador}
                  </p>
                </div>
              </div>
            )}
          </Secao>

          {/* Itens */}
          <Secao titulo={`Itens${itens.length ? ` (${itens.length})` : ""}`} Icon={Package}>
            {itens.length > 0 ? (
              <ul className="divide-y divide-border">
                {itens.map((i, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                    <span className="text-foreground min-w-0">
                      {i.item}
                      {i.observacao && (
                        <span className="block text-xs text-muted-foreground italic">{i.observacao}</span>
                      )}
                    </span>
                    <span className="font-bold text-primary shrink-0 tabular">×{i.quantidade}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {pedido.resumo ?? "Sem itens registrados"}
              </p>
            )}
            {itens.length > 0 && pedido.resumo && (
              <p className="text-xs text-muted-foreground italic border-t border-border pt-2 mt-2">
                Resumo da Maria: {pedido.resumo}
              </p>
            )}
          </Secao>

          {/* Entrega */}
          <Secao titulo="Entrega" Icon={MapPin}>
            <div className="space-y-1">
              {pedido.tipo_fulfillment && (
                <Linha rotulo="Tipo">
                  {pedido.tipo_fulfillment === "entrega" ? "Entrega" :
                    pedido.tipo_fulfillment === "retirada" ? "Retirada no balcão" :
                      pedido.tipo_fulfillment}
                </Linha>
              )}
              {pedido.endereco ? (
                <>
                  <Linha rotulo="Endereço">
                    <EnderecoLink
                      endereco={pedido.endereco}
                      icone={false}
                      linhas={0}
                      className="font-medium"
                    />
                  </Linha>
                  {/* Coordenada do endereço ganha do texto: o OSM não conhece metade
                      das ruas de Araruama, então buscar pelo nome joga o entregador
                      no meio da rua errada. Com o pin, ele chega na porta. */}
                  {local?.latitude != null && local?.longitude != null ? (
                    <a
                      href={`https://maps.google.com/?q=${local.latitude},${local.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline pt-1"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Abrir localização exata
                    </a>
                  ) : (
                    <a
                      href={mapsLink(pedido.endereco)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline pt-1"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Abrir no Google Maps
                    </a>
                  )}
                </>
              ) : (
                <Linha rotulo="Endereço">—</Linha>
              )}
              {pedido.pessoa_recebimento && (
                <Linha rotulo="Quem recebe">{pedido.pessoa_recebimento}</Linha>
              )}
            </div>
            {pedido.obs_entrega && (
              <p className="flex items-start gap-1.5 text-sm text-foreground bg-secondary rounded-lg px-3 py-2 mt-2">
                <StickyNote className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                {pedido.obs_entrega}
              </p>
            )}

            {/* Referência do local, deixada pelo entregador em `enderecos`. */}
            {local?.referencia && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2">
                <Compass className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Referência do local
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-line">{local.referencia}</p>
                </div>
              </div>
            )}

            {(local?.fotos?.length ?? 0) > 0 && (
              <div className="mt-2">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  <Camera className="w-3.5 h-3.5" />
                  Fotos do local ({local!.fotos!.length})
                </p>
                <div className="flex gap-2 flex-wrap">
                  {local!.fotos!.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setFotoAmpliada(url)}
                      className="relative group"
                    >
                      <img
                        src={url}
                        alt={`Foto ${i + 1} do local`}
                        className="w-20 h-20 rounded-lg object-cover border border-border group-hover:opacity-80 transition-opacity"
                      />
                      <ZoomIn className="absolute bottom-1 right-1 w-3.5 h-3.5 text-white drop-shadow opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Secao>

          {/* Pagamento */}
          <Secao titulo="Pagamento" Icon={CreditCard}>
            <div className="space-y-1">
              <Linha rotulo="Forma">{pedido.pagamento ?? "—"}</Linha>
              <Linha rotulo="Total">
                <span className={cn("text-lg", moneyClass(pedido.valor_total))}>
                  {pedido.valor_total != null ? brl(pedido.valor_total) : "—"}
                </span>
              </Linha>
              {pedido.pix_link && (
                <a
                  href={pedido.pix_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline pt-1"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Abrir link do PIX
                </a>
              )}
              {recebido.length > 0 && (
                <div className="border-t border-border pt-2 mt-2 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recebido pelo entregador
                  </p>
                  {recebido.map((pg, i) => (
                    <Linha key={i} rotulo={pg.forma}>
                      <span className={moneyClass(pg.valor)}>{brl(pg.valor)}</span>
                    </Linha>
                  ))}
                  {recebido.length > 1 && (
                    <Linha rotulo="Soma">
                      <span className={moneyClass(totalRecebido)}>{brl(totalRecebido)}</span>
                    </Linha>
                  )}
                  {pedido.valor_total != null && Math.abs(totalRecebido - pedido.valor_total) > 0.009 && (
                    <p className="text-xs font-semibold text-status-ink-cancelado">
                      ⚠ Diferença de {brl(Math.abs(totalRecebido - pedido.valor_total))} em relação ao total
                    </p>
                  )}
                </div>
              )}
            </div>
          </Secao>

          {/* Despacho */}
          {(entregador || despacho) && (
            <Secao titulo="Despacho" Icon={Truck}>
              <div className="space-y-1">
                <Linha rotulo="Entregador">
                  {entregador ? (
                    <span className="inline-flex items-center gap-2">
                      {entregador.nome}
                      {entregador.telefone && (
                        <a
                          href={`https://wa.me/${entregador.telefone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </span>
                  ) : "Não atribuído"}
                </Linha>
                {despacho?.status_entrega && (
                  <Linha rotulo="Situação">{despacho.status_entrega.replace(/_/g, " ")}</Linha>
                )}
                {despacho?.localizacao && (
                  <a
                    href={`https://maps.google.com/?q=${despacho.localizacao}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-status-ink-rua hover:underline pt-1"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    Última posição do entregador
                  </a>
                )}
              </div>

              {timeline.length > 0 && (
                <ul className="border-t border-border pt-2 mt-2 space-y-1.5">
                  {timeline.map((t, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <t.Icon className={cn("w-3.5 h-3.5 shrink-0", t.cor ?? "text-muted-foreground")} />
                      <span className="text-muted-foreground">{t.rotulo}</span>
                      <span className="ml-auto font-medium text-foreground tabular">
                        {hora(t.iso)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Rotulada porque a ficha tem três notas parecidas: esta (só desta
                  entrega), a do cliente e a do local. Sem rótulo, o balcão não
                  sabe qual delas vai se repetir no próximo pedido. */}
              {despacho?.observacao && (
                <div className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 mt-2">
                  <StickyNote className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Nota desta entrega
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-line">{despacho.observacao}</p>
                  </div>
                </div>
              )}

              {fotos.length > 0 && (
                <div className="mt-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    <Camera className="w-3.5 h-3.5" />
                    Fotos da entrega ({fotos.length})
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {fotos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt={`Foto ${i + 1} da entrega`}
                          className="w-20 h-20 rounded-lg object-cover border border-border hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </Secao>
          )}
        </div>

        {/* Por que o pedido caiu — gravado no cancelamento pelo painel. Sem isto,
            o motivo ficava só no banco e no WhatsApp do grupo. */}
        {pedido.status === "cancelado" && pedido.motivo_cancelamento && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-status-cancelado/30 bg-status-cancelado/10 px-3 py-2">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-status-ink-cancelado" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-status-ink-cancelado">
                Motivo do cancelamento
              </p>
              <p className="text-sm text-foreground">{pedido.motivo_cancelamento}</p>
            </div>
          </div>
        )}

        {/* Quem respondeu por este pedido. Distingue o que a Maria fechou sozinha
            do que alguém do balcão digitou ou alterou. */}
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="h-3.5 w-3.5 shrink-0" />
          {pedido.operador_nome
            ? <>Balcão: <span className="font-semibold text-foreground">{pedido.operador_nome}</span></>
            : "Fechado pela Maria, no WhatsApp"}
        </p>

        {podeCancelar && (
          <div className="mt-2">
            {!cancelando ? (
              <button
                onClick={() => setCancelando(true)}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-destructive/40 text-destructive text-sm font-semibold hover:bg-destructive/5 transition-colors"
              >
                <Ban className="w-4 h-4" />
                Cancelar pedido
              </button>
            ) : (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-semibold text-destructive mb-2">
                  Cancelar o pedido {pedido.codigo ?? ""}? Por quê?
                </p>
                <div className="mb-2">
                  <MotivoCancelamento value={motivo} onChange={setMotivo} />
                </div>
                {/* O cliente NÃO é avisado daqui: a regra da casa é que o WhatsApp do
                    cancelamento sai do balcão, que sabe o que combinar (remarcar,
                    devolver pagamento). O grupo recebe o aviso para agir. */}
                <p className="text-[11px] text-muted-foreground mb-2">
                  O cliente não é avisado automaticamente. O grupo Balcão recebe o aviso.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => cancelarPedido.mutate()}
                    disabled={!motivo.trim() || cancelarPedido.isPending}
                    className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-bold disabled:opacity-50"
                  >
                    {cancelarPedido.isPending ? "Cancelando..." : "Confirmar cancelamento"}
                  </button>
                  <button
                    onClick={() => { setCancelando(false); setMotivo(""); }}
                    className="h-9 rounded-lg border border-border px-3 text-sm"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    <ImageLightbox
      src={fotoAmpliada}
      alt="Referência do local"
      open={!!fotoAmpliada}
      onClose={() => setFotoAmpliada(null)}
    />
    </>
  );
}
