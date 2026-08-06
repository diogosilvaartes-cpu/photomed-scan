import { useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, User, MapPin, Phone, Package, Loader2,
  CheckCircle, Clock, Navigation, Ban,
  LocateFixed, LogOut, Camera, MessageSquare, X, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import CodigoPedido from "@/components/CodigoPedido";
import EnderecoLink from "@/components/EnderecoLink";
import MotivoCancelamento from "@/components/MotivoCancelamento";
import ConfirmarPagamentoModal from "@/components/ConfirmarPagamentoModal";
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
  /** Vem no `select("*")`. É por ele que balcão e entregador se referem ao pedido. */
  codigo: string | null;
  cliente_id: string;
  resumo: string | null;
  status: string;
  endereco: string | null;
  /** Liga o pedido à linha de `enderecos` — é o que faz a coordenada pousar certo. */
  endereco_id: string | null;
  valor_total: number | null;
  pagamento: string | null;
  pessoa_recebimento: string | null;
  created_at: string;
  updated_at: string;
  clientes: {
    nome: string | null;
    telefone: string;
    observacoes: string | null;
    foto_url: string | null;
    /** Nota do entregador sobre o cliente — vai no bilhete de toda entrega futura. */
    anotacoes_entregador: string | null;
  } | null;
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
    // Precisa ser string literal: concatenada, o Supabase perde a inferência de tipo.
    .select("*, clientes(nome, telefone, observacoes, foto_url, anotacoes_entregador), itens_pedido(item, quantidade), despacho_entrega(*)")
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
    // Sem telefone o envio era abandonado em silêncio — quem clicou ficava achando
    // que o cliente tinha sido avisado. Agora todo caminho de falha aparece na tela.
    if (!telefone) {
      toast({
        title: "Cliente não foi avisado",
        description: "Esse pedido não tem telefone cadastrado. Avise o balcão.",
        variant: "destructive",
      });
      return;
    }
    try {
      const r = await fetch("/api/notify-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telefone.replace(/\D/g, ""), message: msg }),
      });
      if (!r.ok) {
        // O motivo real (Z-API recusou, sessão caída, número inválido) vale mais que
        // "deu erro": é o que diz se o problema é do pedido ou do WhatsApp da loja.
        const corpo = await r.json().catch(() => ({}));
        throw new Error(corpo?.error ? String(corpo.error) : `HTTP ${r.status}`);
      }
    } catch (e) {
      toast({
        title: "Cliente não foi avisado",
        description: `O status foi salvo, mas o WhatsApp não saiu (${
          e instanceof Error ? e.message : "falha de rede"
        }). Avise o balcão.`,
        variant: "destructive",
      });
    }
  }

  const primeiroNome = nomeCliente.split(" ")[0];

  /**
   * Dispara o evento no WF5_Status_Entregador — o mesmo fluxo do botão do
   * WhatsApp. É o n8n que marca a hora, avisa o cliente, atualiza o status e
   * manda o próximo botão ao entregador.
   *
   * O painel NÃO grava a hora antes: os guards do WF5 (`saiu_em=is.null`) leem
   * "já registrado" e param ali, engolindo a notificação. Era exatamente isso
   * que fazia o cliente não ser avisado quando o toque vinha do painel.
   */
  async function dispararEvento(evento: "saiu" | "chegou") {
    const r = await fetch("/api/entrega-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido_id: pedido.id, evento }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}));
      throw new Error(corpo?.error ? String(corpo.error) : `HTTP ${r.status}`);
    }
  }

  const sairParaEntrega = useMutation({
    mutationFn: () => dispararEvento("saiu"),
    onSuccess: () => {
      toast({ title: "Saiu para entrega!", description: "O cliente foi avisado no WhatsApp." });
      // O n8n grava de forma assíncrona; o refetch imediato ainda pega o valor
      // antigo, então esperamos o suficiente para a linha já estar atualizada.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["entregas-entregador"] }), 1500);
    },
    onError: (e: Error) =>
      toast({
        title: "Não deu para registrar a saída",
        description: `${e.message}. O cliente NÃO foi avisado — tente de novo ou fale com o balcão.`,
        variant: "destructive",
      }),
  });

  /**
   * Cancelar a entrega na rua — cliente ausente, endereço que não existe,
   * desistência na porta. Antes disso o entregador tinha que ligar para o balcão
   * e o pedido ficava aberto no Kanban a tarde inteira.
   *
   * Baixa as duas pontas (pedido e despacho) porque quem olha o Kanban lê
   * `pedidos.status` e quem olha o monitor de entregas lê `status_entrega` —
   * mexer só em uma deixa a outra tela mentindo.
   *
   * De propósito NÃO avisa o cliente: a regra da casa é que o WhatsApp do
   * cancelamento sai do balcão, que sabe o que combinar (remarcar, devolver
   * pagamento). O balcão vê o cancelamento na fila em segundos.
   */
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");

  const cancelarPedido = useMutation({
    mutationFn: async (motivo: string) => {
      const { error } = await externalSupabase
        .from("pedidos").update({ status: "cancelado", motivo_cancelamento: motivo }).eq("id", pedido.id);
      if (error) throw error;
      if (despacho) {
        const { error: e2 } = await externalSupabase
          .from("despacho_entrega")
          .update({ status_entrega: "cancelado" })
          .eq("id", despacho.id);
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      toast({
        title: "Pedido cancelado",
        description: "Avise o balcão pelo WhatsApp para eles falarem com o cliente.",
      });
      setMotivoCancelamento("");
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: (e: Error) =>
      toast({ title: "Não deu para cancelar", description: e.message, variant: "destructive" }),
  });

  const chegarAoLocal = useMutation({
    mutationFn: () => dispararEvento("chegou"),
    onSuccess: () => {
      toast({ title: "Chegada registrada!", description: "O cliente foi avisado no WhatsApp." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["entregas-entregador"] }), 1500);
    },
    onError: (e: Error) =>
      toast({
        title: "Não deu para registrar a chegada",
        description: `${e.message}. O cliente NÃO foi avisado — tente de novo ou fale com o balcão.`,
        variant: "destructive",
      }),
  });

  const [pagamentoOpen, setPagamentoOpen] = useState(false);

  // ── Notas & Fotos ──────────────────────────────────────────────────────────
  // Três destinos diferentes, de propósito:
  //  · observação DESTA entrega  -> despacho_entrega.observacao (morre com o pedido)
  //  · nota sobre o CLIENTE      -> clientes.anotacoes_entregador (vai no bilhete
  //    de todo pedido futuro dele — é o campo que o Desp_Montar_Msg já lê)
  //  · referência do ENDEREÇO    -> enderecos.referencia (idem, por endereço)
  // Antes só existia o primeiro: tudo que o entregador aprendia na rua ("o portão
  // é o verde", "tocar no 202") sumia junto com a entrega.
  const [notasOpen, setNotasOpen] = useState(false);
  const [obsText, setObsText] = useState(despacho?.observacao ?? "");
  const [notaCliente, setNotaCliente] = useState("");
  const [refEndereco, setRefEndereco] = useState("");
  const [fotosFila, setFotosFila] = useState<File[]>([]);
  const [fotoNoEndereco, setFotoNoEndereco] = useState(false);
  const [salvandoNotas, setSalvandoNotas] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  // A linha de `enderecos` só é buscada quando o entregador abre as notas —
  // não vale uma query por card só para o caso de alguém abrir.
  // Agora roda sempre (não só com as notas abertas): o card mostra o link de
  // localização exata, que é o que faz o entregador chegar na porta certa em vez
  // de na rua com nome parecido. Busca por `endereco_id` quando existe — o
  // casamento por texto é o mesmo que deixou a tabela sem coordenada nenhuma.
  const { data: enderecoRow } = useQuery({
    queryKey: ["endereco-do-pedido", pedido.endereco_id, pedido.cliente_id, pedido.endereco],
    queryFn: async () => {
      const q = externalSupabase
        .from("enderecos")
        .select("id, referencia, fotos, latitude, longitude");
      const { data } = pedido.endereco_id
        ? await q.eq("id", pedido.endereco_id).limit(1)
        : await q
            .eq("cliente_id", pedido.cliente_id)
            .eq("label_exibicao", pedido.endereco!)
            .limit(1);
      return data?.[0] ?? null;
    },
    enabled: !!pedido.cliente_id && (!!pedido.endereco_id || !!pedido.endereco),
  });

  // Recarrega os campos toda vez que o painel abre: outra pessoa (ou o balcão)
  // pode ter mexido desde a última vez.
  useEffect(() => {
    if (!notasOpen) return;
    setObsText(despacho?.observacao ?? "");
    setNotaCliente(pedido.clientes?.anotacoes_entregador ?? "");
  }, [notasOpen]);

  useEffect(() => {
    if (enderecoRow) setRefEndereco(enderecoRow.referencia ?? "");
  }, [enderecoRow]);

  /**
   * Salva os três campos + as fotos. Cada gravação é independente e só acontece
   * se houve mudança — assim uma nota de cliente não sobrescreve o que outro
   * entregador escreveu enquanto este card estava aberto sem ser tocado.
   *
   * Falha aparece na tela: nota do entregador que some em silêncio é pior do
   * que nota que nunca existiu, porque ele acha que registrou.
   */
  async function salvarNotas() {
    if (!despacho) return;
    setSalvandoNotas(true);
    try {
      const novasUrls: string[] = [];
      for (const file of fotosFila) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${despacho.id}/${Date.now()}-${novasUrls.length}.${ext}`;
        const { error: upErr } = await externalSupabase.storage.from("entregas").upload(path, file);
        if (upErr) throw upErr;
        const { data } = externalSupabase.storage.from("entregas").getPublicUrl(path);
        novasUrls.push(data.publicUrl);
      }

      const { error: e1 } = await externalSupabase
        .from("despacho_entrega")
        .update({ observacao: obsText || null, fotos: [...(despacho.fotos ?? []), ...novasUrls] })
        .eq("id", despacho.id);
      if (e1) throw e1;

      if (notaCliente !== (pedido.clientes?.anotacoes_entregador ?? "")) {
        const { error: e2 } = await externalSupabase
          .from("clientes")
          .update({ anotacoes_entregador: notaCliente || null })
          .eq("id", pedido.cliente_id);
        if (e2) throw e2;
      }

      if (enderecoRow) {
        const mudouRef = refEndereco !== (enderecoRow.referencia ?? "");
        const guardarFotos = fotoNoEndereco && novasUrls.length > 0;
        if (mudouRef || guardarFotos) {
          const patch: Record<string, unknown> = {};
          if (mudouRef) patch.referencia = refEndereco || null;
          if (guardarFotos) patch.fotos = [...(enderecoRow.fotos ?? []), ...novasUrls];
          const { error: e3 } = await externalSupabase
            .from("enderecos")
            .update(patch)
            .eq("id", enderecoRow.id);
          if (e3) throw e3;
        }
      }

      setFotosFila([]);
      setFotoNoEndereco(false);
      toast({ title: "Notas salvas!" });
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
      qc.invalidateQueries({ queryKey: ["endereco-do-pedido"] });
    } catch (err) {
      toast({
        title: "Não deu para salvar",
        description: err instanceof Error ? err.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setSalvandoNotas(false);
    }
  }

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
        // GPS do entregador vira a coordenada do endereço — é a localização mais
        // confiável que existe, porque veio de alguém que chegou na porta.
        //
        // Casava por `label_exibicao` = texto exato, e era por isso que a tabela
        // `enderecos` estava com latitude/longitude NULL em TODAS as linhas: basta
        // uma vírgula ou maiúscula diferente entre o texto do pedido e o do cadastro
        // para o update não achar nada — e ele falha em silêncio, sem erro.
        // Com `endereco_id` o alvo é a linha certa.
        //
        // ⚠️ Só grava quando o endereço AINDA NÃO TEM coordenada: aí não há nada
        // para substituir e não faz sentido perguntar. Havendo coordenada, quem
        // decide é o entregador, pelo botão de compartilhar localização — trocar
        // um ponto bom por outro é destrutivo e não pode acontecer sozinho.
        const enderecoSemCoord = !(enderecoRow?.latitude != null && enderecoRow?.longitude != null);
        if (enderecoSemCoord && despacho.localizacao && (pedido.endereco_id || pedido.endereco)) {
          const coords = despacho.localizacao.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
          if (coords) {
            const patch = {
              latitude: parseFloat(coords[1]),
              longitude: parseFloat(coords[2]),
            };
            if (pedido.endereco_id) {
              await externalSupabase.from("enderecos").update(patch).eq("id", pedido.endereco_id);
            } else {
              await externalSupabase
                .from("enderecos")
                .update(patch)
                .eq("cliente_id", pedido.cliente_id)
                .eq("label_exibicao", pedido.endereco!);
            }
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

  /**
   * Coordenada recém-capturada esperando decisão: virar (ou não) a localização
   * oficial DAQUELE endereço. Fica em estado, e não gravada direto, porque
   * sobrescrever a coordenada boa de um endereço é destrutivo e silencioso — o
   * entregador pode ter tocado no botão dentro do carro, a três quarteirões.
   */
  const [propostaLocal, setPropostaLocal] = useState<string | null>(null);
  const [salvandoLocal, setSalvandoLocal] = useState(false);

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
      // Sem endereço cadastrado não há o que substituir — nada a perguntar.
      if (loc && (pedido.endereco_id || enderecoRow?.id)) setPropostaLocal(loc);
      qc.invalidateQueries({ queryKey: ["entregas-entregador"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erro";
      toast({ title: "Não foi possível obter localização", description: msg, variant: "destructive" });
    },
  });

  /** Grava a coordenada proposta no endereço DESTE pedido. */
  async function aplicarLocalNoEndereco() {
    if (!propostaLocal) return;
    const m = propostaLocal.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
    if (!m) { setPropostaLocal(null); return; }

    setSalvandoLocal(true);
    const patch = { latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) };
    // Por id sempre que houver: casar por texto é o que deixou a tabela inteira
    // sem coordenada, e aqui erraria de endereço em vez de só falhar.
    const alvo = pedido.endereco_id ?? enderecoRow?.id ?? null;
    const { error } = alvo
      ? await externalSupabase.from("enderecos").update(patch).eq("id", alvo)
      : { error: new Error("Endereço não identificado") };
    setSalvandoLocal(false);

    if (error) {
      toast({ title: "Não deu para salvar no endereço", description: error.message, variant: "destructive" });
      return;
    }
    setPropostaLocal(null);
    qc.invalidateQueries({ queryKey: ["endereco-do-pedido"] });
    toast({
      title: "Localização do endereço atualizada",
      description: "As próximas entregas neste endereço já usam este ponto.",
    });
  }

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
            <CodigoPedido codigo={pedido.codigo} />
            {cancelado && <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Cancelado</span>}
          </div>
          <p className="text-sm font-semibold text-foreground">{nomeCliente}</p>
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

      {/* Endereço — clicável: o entregador precisa do caminho, não do texto */}
      {pedido.endereco && (
        <div className="bg-secondary rounded-lg px-3 py-2 space-y-1">
          <EnderecoLink endereco={pedido.endereco} linhas={0} className="flex gap-2" />
          {/* A coordenada deste endereço específico. Buscar pelo nome joga o
              entregador no meio da rua (quando o OSM conhece a rua); o pin leva
              na porta. Só aparece quando ESTE endereço tem localização salva. */}
          {enderecoRow?.latitude != null && enderecoRow?.longitude != null && (
            <a
              href={`https://maps.google.com/?q=${enderecoRow.latitude},${enderecoRow.longitude}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-status-ink-rua hover:underline"
            >
              <Navigation className="w-3.5 h-3.5" />
              Ir pela localização exata
            </a>
          )}
          {enderecoRow?.referencia && (
            <p className="text-xs text-muted-foreground">📍 {enderecoRow.referencia}</p>
          )}

          {/* Recém-capturada, esperando decisão. Diz claramente se vai SUBSTITUIR
              um ponto que já existe ou salvar o primeiro — são coisas diferentes
              e só uma delas é destrutiva. */}
          {propostaLocal && (
            <div className="mt-1 rounded-lg border border-status-novo/40 bg-status-novo/10 p-2">
              <p className="text-xs font-semibold text-status-ink-novo">
                {enderecoRow?.latitude != null
                  ? "Substituir a localização salva deste endereço pela sua posição atual?"
                  : "Salvar sua posição atual como a localização deste endereço?"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Vale para as próximas entregas neste endereço, não só para esta.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); aplicarLocalNoEndereco(); }}
                  disabled={salvandoLocal}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-status-novo text-xs font-bold text-white disabled:opacity-60"
                >
                  {salvandoLocal && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {enderecoRow?.latitude != null ? "Substituir" : "Salvar"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPropostaLocal(null); }}
                  className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
                >
                  Agora não
                </button>
              </div>
            </div>
          )}
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
          className="flex items-center justify-between gap-2 w-full h-10 px-3 rounded-xl text-sm font-semibold bg-status-separacao/10 text-status-ink-separacao hover:bg-status-separacao/20 transition-colors border border-status-separacao/30">
          <span className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            {`Notas & Fotos${
              despacho?.observacao || despacho?.fotos?.length || pedido.clientes?.anotacoes_entregador
                ? " ✓"
                : ""
            }`}
          </span>
          {notasOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {notasOpen && (
          <div className="mt-2 space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Sobre esta entrega
              </label>
              <textarea
                rows={2}
                placeholder="Ex.: cliente não estava, deixei com o vizinho..."
                value={obsText}
                onChange={e => setObsText(e.target.value)}
                className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">Fica só neste pedido.</p>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Sobre o cliente
              </label>
              <textarea
                rows={2}
                placeholder="Ex.: tem cachorro solto, chamar do portão..."
                value={notaCliente}
                onChange={e => setNotaCliente(e.target.value)}
                className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Aparece no WhatsApp de <b>todas</b> as próximas entregas deste cliente.
              </p>
            </div>

            {pedido.endereco && (
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Referência do endereço
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex.: portão verde ao lado da padaria, 2º andar..."
                  value={refEndereco}
                  onChange={e => setRefEndereco(e.target.value)}
                  disabled={!enderecoRow}
                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[10px] text-muted-foreground">
                  {enderecoRow
                    ? "Aparece no bilhete de quem for entregar neste endereço."
                    : "Endereço deste pedido não está cadastrado — só dá para salvar a referência de um endereço cadastrado."}
                </p>
              </div>
            )}

            {/* Fotos já salvas — desta entrega e do local */}
            {(despacho?.fotos?.length ?? 0) > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Fotos desta entrega
                </p>
                <div className="flex gap-2 flex-wrap">
                  {despacho!.fotos!.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`foto ${i+1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {(enderecoRow?.fotos?.length ?? 0) > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Fotos do local (salvas)
                </p>
                <div className="flex gap-2 flex-wrap">
                  {enderecoRow!.fotos!.map((url: string, i: number) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`local ${i+1}`} className="w-16 h-16 object-cover rounded-lg border border-primary/40" />
                    </a>
                  ))}
                </div>
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
            {enderecoRow && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={fotoNoEndereco}
                  onChange={e => setFotoNoEndereco(e.target.checked)}
                  className="w-4 h-4 accent-[hsl(var(--primary))]"
                />
                Guardar também no endereço (fica para as próximas entregas)
              </label>
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
                disabled={salvandoNotas || !despacho}
                onClick={salvarNotas}>
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

        {!entregue && (
          <>
            <Button
              className="w-full text-status-ink-cancelado hover:text-status-ink-cancelado hover:bg-status-cancelado/10"
              variant="ghost"
              onClick={() => setConfirmarCancelar(true)}
              disabled={cancelarPedido.isPending}>
              {cancelarPedido.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Ban className="w-4 h-4 mr-2" />}
              Cancelar pedido
            </Button>

            <AlertDialog
              open={confirmarCancelar}
              onOpenChange={(v) => { setConfirmarCancelar(v); if (!v) setMotivoCancelamento(""); }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancelar o pedido {pedido.codigo ?? ""}? Por quê?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {nomeCliente}
                    {pedido.itens_pedido?.length
                      ? ` · ${pedido.itens_pedido.length} ${pedido.itens_pedido.length === 1 ? "item" : "itens"}`
                      : ""}
                    {pedido.valor_total != null ? ` · R$ ${pedido.valor_total.toFixed(2)}` : ""}.
                    <br />
                    A entrega é encerrada e o pedido sai da fila do balcão. O cliente
                    <b> não</b> é avisado automaticamente — combine com o balcão.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <MotivoCancelamento value={motivoCancelamento} onChange={setMotivoCancelamento} />
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => cancelarPedido.mutate(motivoCancelamento)}
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

      <ConfirmarPagamentoModal
        open={pagamentoOpen}
        onClose={() => setPagamentoOpen(false)}
        valorEsperado={pedido.valor_total}
        itensIniciais={despacho?.pagamento_recebido ?? []}
        pending={marcarEntregue.isPending}
        onConfirmar={(pagamentos) => marcarEntregue.mutate(pagamentos)}
      />
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
