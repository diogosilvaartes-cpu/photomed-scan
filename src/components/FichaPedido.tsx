import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Phone, MapPin, CreditCard, Package, Truck, Clock, CheckCircle, Navigation,
  LocateFixed, Copy, Check, StickyNote, User, Hash, Camera, Link2, ChevronRight,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { statusConfig, brl, moneyClass } from "@/lib/status";
import {
  type Pedido, type EntregadorFull,
  fichaTexto, formatPhone, fotoWhatsApp, isCoords, itensValidos, mapsLink, pedidoNumero, timeAgo,
} from "@/lib/pedido";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Ficha completa do pedido — o mesmo resumo que vai para o entregador,
 * em formato de card expandido. Abre ao clicar em qualquer card da fila.
 * Somente leitura: toda ação continua nos cards.
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
  const [copiado, setCopiado] = useState(false);
  const navigate = useNavigate();

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

  const recebido = despacho?.pagamento_recebido ?? [];
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

  async function copiar() {
    try {
      await navigator.clipboard.writeText(fichaTexto(pedido, entregador?.nome));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard bloqueado — sem alarde */
    }
  }

  return (
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
            <span className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <Hash className="w-3 h-3" />
              {pedidoNumero(pedido)}
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
                Resumo da Ana: {pedido.resumo}
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
                    {isCoords(pedido.endereco) ? "Localização GPS" : pedido.endereco}
                  </Linha>
                  <a
                    href={mapsLink(pedido.endereco)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline pt-1"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    Abrir no Google Maps
                  </a>
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

              {despacho?.observacao && (
                <p className="flex items-start gap-1.5 text-sm text-foreground bg-secondary rounded-lg px-3 py-2 mt-2">
                  <StickyNote className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                  {despacho.observacao}
                </p>
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

        <button
          onClick={copiar}
          className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
        >
          {copiado
            ? <><Check className="w-4 h-4" />Ficha copiada!</>
            : <><Copy className="w-4 h-4" />Copiar ficha do entregador</>}
        </button>
      </DialogContent>
    </Dialog>
  );
}
