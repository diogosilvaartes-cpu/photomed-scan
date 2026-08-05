import { useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, User, MapPin, Phone, Package, Loader2,
  CheckCircle, Clock, Navigation,
  LocateFixed, LogOut, Camera, MessageSquare, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Os mapas de status e o tipo Entregador viviam aqui só para o card de admin, que saiu
// deste arquivo. A fonte única de label/cor de status é `src/lib/status.ts`.

type ItemPagamento = { forma: string; valor: number };

type DespachoEntrega = {
  id: string;
  entregador_id: string | null;
  status_entrega: string;
  observacao: string | null;
  fotos: string[] | null;
  enviado_em: string;
  entregue_em: string | null;
  saiu_em: string | null;
  chegou_em: string | null;
  localizacao: string | null;
  pagamento_recebido: ItemPagamento[] | null;
};

type PedidoEntrega = {
  id: string;
  cliente_id: string;
  resumo: string | null;
  status: string;
  endereco: string | null;
  valor_total: number | null;
  pagamento: string | null;
  pessoa_recebimento: string | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string | null; telefone: string; observacoes: string | null; foto_url: string | null } | null;
  itens_pedido: { item: string; quantidade: number }[];
  despacho_entrega: DespachoEntrega[];
};

async function fetchEntregasEntregador(entregadorId: string): Promise<PedidoEntrega[]> {
  // Get despachos for this entregador
  const { data: despachos, error: de } = await externalSupabase
    .from("despacho_entrega")
    .select("pedido_id")
    .eq("entregador_id", entregadorId);
  if (de) throw de;

  const pedidoIds = (despachos ?? []).map((d) => d.pedido_id);
  if (!pedidoIds.length) return [];

  const { data, error } = await externalSupabase
    .from("pedidos")
    .select("*, clientes(nome, telefone, observacoes, foto_url), itens_pedido(item, quantidade), despacho_entrega(*)")
    .in("id", pedidoIds)
    .not("status", "in", '("retirado")')
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PedidoEntrega[];
}

function CardEntregaEntregador({ pedido }: { pedido: PedidoEntrega }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { entregadorId } = useAuth();

  const despacho = pedido.despacho_entrega.find((d) => d.entregador_id === entregadorId);
  const nomeCliente = pedido.clientes?.nome ?? pedido.clientes?.telefone ?? "—";
  const telefone = pedido.clientes?.telefone ?? "";

  const saiu = !!despacho?.saiu_em;
  const chegou = !!despacho?.chegou_em;
  const entregue = pedido.status === "entregue";
  const cancelado = pedido.status === "cancelado";

  // Não bloqueia o fluxo, mas avisa na tela quando o WhatsApp não sai — foi o
  // silêncio total aqui que escondeu por semanas uma instância Z-API morta.
  async function notificarCliente(msg: string) {
    if (!telefone) return;
    try {
      const r = await fetch("/api/notify-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telefone.replace(/\D/g, ""), message: msg }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      toast({
        title: "Cliente não foi avisado",
        description: "O status foi salvo, mas o WhatsApp não saiu. Avise o balcão.",
        variant: "destructive",
      });
    }
  }

  const primeiroNome = nomeCliente.split(" ")[0];

  const sairParaEntrega = useMutation({
    mutationFn: async () => {
      if (!despacho) return;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ saiu_em: new Date().toISOString() })
        .eq("id", despacho.id);
      if (error) throw error;
      await externalSupabase.from("pedidos").update({ status: "saiu_para_entrega" }).eq("id", pedido.id);
      await notificarCliente(
        `Olá, ${primeiroNome}! 🛵 Seu pedido saiu para entrega. Em breve estará com você!`
      );
    },
    onSuccess: () => {
      toast({ title: "Saiu para entrega!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const chegarAoLocal = useMutation({
    mutationFn: async () => {
      if (!despacho) return;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ chegou_em: new Date().toISOString() })
        .eq("id", despacho.id);
      if (error) throw error;
      await notificarCliente(
        `Olá, ${primeiroNome}! 📍 Nosso entregador chegou ao seu endereço. Já vai chamar!`
      );
    },
    onSuccess: () => {
      toast({ title: "Chegada registrada!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagItems, setPagItems] = useState<ItemPagamento[]>([]);
  const [pagForma, setPagForma] = useState("Dinheiro");
  const [pagValor, setPagValor] = useState("");

  const [notasOpen, setNotasOpen] = useState(false);
  const [obsText, setObsText] = useState(despacho?.observacao ?? "");
  const [fotosFila, setFotosFila] = useState<File[]>([]);
  const [salvandoNotas, setSalvandoNotas] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pagamentoOpen) {
      setPagItems(despacho?.pagamento_recebido ?? []);
      setPagForma("Dinheiro");
      setPagValor(pedido.valor_total?.toFixed(2) ?? "");
    }
  }, [pagamentoOpen]);

  function addPagItem() {
    const v = parseFloat(pagValor.replace(",", "."));
    if (!v || v <= 0) return;
    setPagItems((p) => [...p, { forma: pagForma, valor: v }]);
    setPagValor("");
  }

  const totalPago = pagItems.reduce((s, i) => s + i.valor, 0);

  const marcarEntregue = useMutation({
    mutationFn: async (pagamentos: ItemPagamento[]) => {
      const { error } = await externalSupabase
        .from("pedidos").update({ status: "entregue" }).eq("id", pedido.id);
      if (error) throw error;
      if (despacho) {
        await externalSupabase
          .from("despacho_entrega")
          .update({
            status_entrega: "entregue",
            entregue_em: new Date().toISOString(),
            pagamento_recebido: pagamentos.length ? pagamentos : null,
          })
          .eq("id", despacho.id);
        // Se o entregador registrou localização GPS, atualizar as coordenadas do endereço do cliente
        if (despacho.localizacao && pedido.endereco) {
          const coords = despacho.localizacao.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
          if (coords) {
            await externalSupabase
              .from("enderecos")
              .update({ latitude: parseFloat(coords[1]), longitude: parseFloat(coords[2]) })
              .eq("cliente_id", pedido.cliente_id)
              .eq("label_exibicao", pedido.endereco);
          }
        }
      }
      await notificarCliente(
        `Olá, ${primeiroNome}! ✅ Pedido entregue com sucesso! Obrigado por comprar na Farmácia Vital. 💚`
      );
    },
    onSuccess: () => {
      toast({ title: "Entrega confirmada!" });
      setPagamentoOpen(false);
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: () => toast({ title: "Erro", variant: "destructive" }),
  });

  const compartilharLocalizacao = useMutation({
    mutationFn: async () => {
      if (!despacho) throw new Error("Sem despacho");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const localizacao = `${pos.coords.latitude},${pos.coords.longitude}`;
      const { error } = await externalSupabase
        .from("despacho_entrega")
        .update({ localizacao })
        .eq("id", despacho.id);
      if (error) throw error;
      return localizacao;
    },
    onSuccess: (loc) => {
      toast({ title: "Localização salva!", description: loc });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erro";
      toast({ title: "Não foi possível obter localização", description: msg, variant: "destructive" });
    },
  });

  const mapsUrl = pedido.endereco
    ? /^-?\d+\.\d+,-?\d+\.\d+$/.test(pedido.endereco.trim())
      ? `https://maps.google.com/?q=${pedido.endereco}`
      : `https://maps.google.com/?q=${encodeURIComponent(pedido.endereco)}`
    : null;
  const wppUrl = telefone ? `https://wa.me/${telefone.replace(/\D/g, "")}` : null;
  const locMapsUrl = despacho?.localizacao
    ? `https://maps.google.com/?q=${despacho.localizacao}`
    : null;

  // Busca imagens dos produtos no estoque
  const itemNomes = pedido.itens_pedido.map((i) => i.item);
  const { data: estoqueImgs } = useQuery({
    queryKey: ["estoque-imgs", pedido.id],
    queryFn: async () => {
      if (!itemNomes.length) return {};
      const { data } = await externalSupabase
        .from("estoque").select("nome, imagem_url").in("nome", itemNomes);
      return Object.fromEntries((data ?? []).filter(e => e.imagem_url).map(e => [e.nome, e.imagem_url]));
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className={`bg-card border rounded-xl p-4 space-y-3 ${cancelado ? "border-red-500 opacity-70" : "border-border"}`}>

      {/* Header cliente */}
      <div className="flex items-center gap-3">
        {pedido.clientes?.foto_url ? (
          <img src={pedido.clientes.foto_url} alt={nomeCliente}
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-border" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-primary" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{nomeCliente}</p>
            {cancelado && <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Cancelado</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(pedido.created_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>
        {/* A receber em destaque */}
        {pedido.valor_total != null && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">A receber</p>
            <p className="text-lg font-bold text-money">R$ {pedido.valor_total.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Observações do cliente */}
      {pedido.clientes?.observacoes && (
        <div className="flex items-start gap-2 bg-status-separacao/10 border border-status-separacao/30 rounded-lg px-3 py-2 text-xs text-status-ink-separacao font-medium">
          <span className="shrink-0 font-semibold">⚠ Obs:</span>
          <span>{pedido.clientes.observacoes}</span>
        </div>
      )}

      {/* Endereço */}
      {pedido.endereco && (
        <div className="flex items-start gap-2 bg-secondary rounded-lg px-3 py-2">
          <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{pedido.endereco}</span>
        </div>
      )}

      {/* Resumo completo */}
      <div className="bg-secondary rounded-xl p-3 space-y-2">
        {pedido.itens_pedido.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Itens</p>
            <ul className="space-y-2">
              {pedido.itens_pedido.map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  {estoqueImgs?.[item.item] ? (
                    <img src={estoqueImgs[item.item]} alt={item.item}
                      className="w-10 h-10 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="flex-1 text-sm">{item.item}</span>
                  <span className="text-sm font-semibold text-muted-foreground">×{item.quantidade}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pedido.pessoa_recebimento && (
          <div className="border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">Recebedor: </span>
            <span className="font-medium">{pedido.pessoa_recebimento}</span>
          </div>
        )}
      </div>

      {/* Links rápidos + CRM */}
      <div className="flex gap-2">
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-status-novo/10 text-status-ink-novo hover:bg-status-novo/20 transition-colors border border-status-novo/30">
            <Navigation className="w-4 h-4" /> Maps
          </a>
        )}
        {wppUrl && (
          <a href={wppUrl} target="_blank" rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-status-entregue/10 text-status-ink-entregue hover:bg-status-entregue/20 transition-colors border border-status-entregue/30">
            <Phone className="w-4 h-4" /> WhatsApp
          </a>
        )}
        <a href={`/clientes?id=${pedido.cliente_id}`}
          className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors border border-border">
          <User className="w-4 h-4" /> CRM
        </a>
      </div>

      {/* Notas & Fotos do entregador */}
      <div>
        <button
          onClick={() => setNotasOpen(v => !v)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
          <MessageSquare className="w-3.5 h-3.5" />
          {notasOpen ? "Fechar notas" : `Notas & Fotos${(despacho?.observacao || despacho?.fotos?.length) ? " ✓" : ""}`}
        </button>
        {notasOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              rows={2}
              placeholder="Observação da entrega..."
              value={obsText}
              onChange={e => setObsText(e.target.value)}
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {/* Fotos existentes */}
            {(despacho?.fotos?.length ?? 0) > 0 && (
              <div className="flex gap-2 flex-wrap">
                {despacho!.fotos!.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`foto ${i+1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                  </a>
                ))}
              </div>
            )}
            {/* Fotos na fila */}
            {fotosFila.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {fotosFila.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg border border-primary/50" />
                    <button
                      onClick={() => setFotosFila(p => p.filter((_, idx) => idx !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => inputFotoRef.current?.click()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 transition-colors">
                <Camera className="w-3.5 h-3.5" /> Adicionar foto
              </button>
              <input
                ref={inputFotoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => {
                  if (e.target.files) setFotosFila(p => [...p, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={salvandoNotas}
                onClick={async () => {
                  if (!despacho) return;
                  setSalvandoNotas(true);
                  try {
                    const novasUrls: string[] = [];
                    for (const file of fotosFila) {
                      const ext = file.name.split(".").pop() ?? "jpg";
                      const path = `${despacho.id}/${Date.now()}.${ext}`;
                      const { error: upErr } = await externalSupabase.storage.from("entregas").upload(path, file);
                      if (!upErr) {
                        const { data } = externalSupabase.storage.from("entregas").getPublicUrl(path);
                        novasUrls.push(data.publicUrl);
                      }
                    }
                    const fotosAtuais = despacho.fotos ?? [];
                    await externalSupabase.from("despacho_entrega")
                      .update({ observacao: obsText || null, fotos: [...fotosAtuais, ...novasUrls] })
                      .eq("id", despacho.id);
                    setFotosFila([]);
                    qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
                  } finally { setSalvandoNotas(false); }
                }}>
                {salvandoNotas ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Localização registrada */}
      {despacho?.localizacao && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2">
          <LocateFixed className="w-3.5 h-3.5 text-money shrink-0" />
          <span className="flex-1">Localização registrada</span>
          {locMapsUrl && (
            <a href={locMapsUrl} target="_blank" rel="noreferrer" className="text-primary font-medium">Ver</a>
          )}
        </div>
      )}

      {/* Botões de ação */}
      {!cancelado && <div className="space-y-2">
        {!entregue && !saiu && (
          <Button className="w-full" variant="outline"
            onClick={() => sairParaEntrega.mutate()}
            disabled={sairParaEntrega.isPending}>
            {sairParaEntrega.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
            Sair para entrega
          </Button>
        )}

        {!chegou && !entregue && (
          <Button className="w-full" variant="outline"
            onClick={() => chegarAoLocal.mutate()}
            disabled={chegarAoLocal.isPending}>
            {chegarAoLocal.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
            Cheguei ao local
          </Button>
        )}

        {!entregue && (
          <Button className="w-full" variant="outline"
            onClick={() => compartilharLocalizacao.mutate()}
            disabled={compartilharLocalizacao.isPending}>
            {compartilharLocalizacao.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LocateFixed className="w-4 h-4 mr-2" />}
            {despacho?.localizacao ? "Atualizar localização" : "Compartilhar localização"}
          </Button>
        )}

        <Button className="w-full"
          onClick={() => !entregue && setPagamentoOpen(true)}
          disabled={marcarEntregue.isPending || entregue}>
          {entregue
            ? <><CheckCircle className="w-4 h-4 mr-2" />Entregue</>
            : <><CheckCircle className="w-4 h-4 mr-2" />Marcar como entregue</>}
        </Button>
      </div>}

      {/* Pagamento recebido registrado */}
      {entregue && despacho?.pagamento_recebido?.length ? (
        <div className="bg-status-entregue/10 border border-status-entregue/25 rounded-lg px-3 py-2 text-xs space-y-0.5">
          <p className="font-semibold text-status-ink-entregue">Pagamento recebido:</p>
          {despacho.pagamento_recebido.map((p, i) => (
            <p key={i} className="text-status-ink-entregue">{p.forma}: R$ {p.valor.toFixed(2)}</p>
          ))}
        </div>
      ) : null}

      {/* Modal de pagamento */}
      <Dialog open={pagamentoOpen} onOpenChange={setPagamentoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {pedido.valor_total != null && (
              <div className="flex justify-between items-center bg-secondary rounded-xl px-4 py-3">
                <span className="text-sm text-muted-foreground">Valor esperado</span>
                <span className="text-lg font-bold text-foreground">R$ {pedido.valor_total.toFixed(2)}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Adicionar pagamento</Label>
              <div className="flex gap-2">
                <select
                  value={pagForma}
                  onChange={(e) => setPagForma(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1">
                  {["Dinheiro", "Pix", "Cartão Débito", "Cartão Crédito", "Outro"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <Input
                  type="number" step="0.01" min="0"
                  placeholder="0,00"
                  value={pagValor}
                  onChange={(e) => setPagValor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPagItem()}
                  className="w-28" />
                <Button type="button" size="sm" variant="outline" onClick={addPagItem}>+</Button>
              </div>
            </div>
            {pagItems.length > 0 && (
              <div className="space-y-1">
                {pagItems.map((p, i) => (
                  <div key={i} className="flex justify-between items-center text-sm bg-secondary rounded-lg px-3 py-1.5">
                    <span>{p.forma}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">R$ {p.valor.toFixed(2)}</span>
                      <button onClick={() => setPagItems((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold px-3 pt-1">
                  <span>Total recebido</span>
                  <span className={totalPago >= (pedido.valor_total ?? 0) ? "text-money" : "text-status-ink-separacao"}>
                    R$ {totalPago.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagamentoOpen(false)}>Cancelar</Button>
            <Button onClick={() => marcarEntregue.mutate(pagItems)} disabled={marcarEntregue.isPending}>
              {marcarEntregue.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Confirmar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Tela de trabalho do ENTREGADOR. O admin nunca chega aqui — é redirecionado para /pedidos,
 * que tem a fila inteira. Por isso não existe mais nenhuma variante "admin" neste arquivo:
 * a que existia era código inalcançável e só produzia erro de tipo.
 */
export default function Entregas() {
  const { role, entregadorId, entregadorNome } = useAuth();

  const { data: pedidos, isLoading } = useQuery({
    queryKey: ["entregas-entregador", entregadorId],
    queryFn: () => fetchEntregasEntregador(entregadorId!),
    enabled: role !== "admin" && !!entregadorId,
    refetchInterval: 30_000,
  });

  // Admin vai para Pedidos (após todos os hooks)
  if (role === "admin") return <Navigate to="/pedidos" replace />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const emAndamento = pedidos?.filter((p) => p.status !== "entregue" && p.status !== "cancelado") ?? [];
  const finalizados = pedidos?.filter((p) => p.status === "entregue" || p.status === "cancelado") ?? [];

  // Agrupa por data de criação
  function groupByDate(list: PedidoEntrega[]) {
    const groups: Record<string, PedidoEntrega[]> = {};
    list.forEach((p) => {
      const key = format(new Date(p.created_at), "EEEE, dd/MM/yyyy", { locale: ptBR });
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return Object.entries(groups);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Entregas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {`Olá, ${entregadorNome} — ${emAndamento.length} entrega(s) pendente(s)`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" /><span>30s</span>
        </div>
      </div>

      {pedidos?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma entrega no momento.</p>
        </div>
      ) : (
        <>
          {/* Em andamento — agrupado por data */}
          {emAndamento.length > 0 && (
            <div className="mb-6">
              {groupByDate(emAndamento).map(([date, items]) => (
                <div key={date} className="mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 capitalize">{date}</p>
                  <div className="space-y-3">
                    {items.map((p) => <CardEntregaEntregador key={p.id} pedido={p} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Histórico (entregues + cancelados) */}
          {finalizados.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Histórico</p>
              <div className="space-y-3 opacity-75">
                {finalizados.map((p) => <CardEntregaEntregador key={p.id} pedido={p} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
