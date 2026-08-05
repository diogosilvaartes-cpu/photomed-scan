import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessagesSquare, Loader2, Bot, Headset, Search, Clock, Pause, Play, RotateCcw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { fotoWhatsApp } from "@/lib/pedido";
import { cn } from "@/lib/utils";

/**
 * Conversas — quem está falando com o cliente agora: a Maria ou o balcão.
 *
 * Vive como aba dentro de /pedidos (05/08): olhar a fila e olhar quem está sendo
 * atendido é o mesmo movimento do balcão.
 *
 * O handoff é automático: basta o atendente digitar no celular da farmácia
 * (`fromApi = false` no webhook da Z-API) e o n8n põe a conversa em
 * `aguardando_humano` com `pausada_ate = agora + 2h`. Enquanto esse prazo não
 * vence, o nó `IF_Ana_Pausada` (Ana_Agente) corta a execução antes do LLM: a Maria
 * fica calada e as mensagens do cliente só entram no histórico.
 *
 * Esta tela é o caminho de volta — e o de ida, para assumir sem precisar digitar.
 *
 * ⚠️ O prazo da pausa NÃO é definido aqui. Ele é o default de `pausar_ana` no
 * Postgres, que o n8n também usa omitindo o parâmetro. Um número só, num lugar só.
 *
 * ⚠️ Os nomes de nó e de RPC do n8n continuam com "Ana" de propósito — renomear
 * `devolver_para_ana`/`IF_Ana_Pausada` exigiria acertar workflow e painel na mesma
 * hora, e a troca pedida era do nome que o CLIENTE vê.
 */

const POLL_MS = 20_000;

/** Estados em que a Maria toca a conversa normalmente. */
const ESTADO_LABEL: Record<string, string> = {
  novo_contato: "Novo contato",
  entendendo_pedido: "Montando o pedido",
  coletando_endereco: "Pegando o endereço",
  confirmando_resumo: "Confirmando o resumo",
  pedido_criado: "Pedido fechado",
  aguardando_humano: "Com o balcão",
};

export type Turno = { role: string; content: string };

export type ConversaRow = {
  id: string;
  cliente_id: string;
  estado: string;
  ultima_mensagem: string | null;
  resumo_contexto: string | null;
  pausada_ate: string | null;
  updated_at: string;
  clientes: { nome: string | null; telefone: string; foto_url: string | null } | null;
};

/**
 * `resumo_contexto` é TEXT com um array JSON escrito pelo n8n. Já veio quebrado
 * antes (surrogates inválidos, encoding), então um parse solto aqui derruba a tela
 * inteira do balcão. Falhou, mostra vazio.
 */
export function parseHistorico(raw: string | null): Turno[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t) => t && typeof t.content === "string");
  } catch {
    return [];
  }
}

export type Pausa = { pausada: boolean; minutosRestantes: number };

/**
 * A Maria só está de fato calada com as DUAS coisas: estado `aguardando_humano` e
 * prazo no futuro. Com o prazo vencido ela já reassumiu sozinha, mesmo com o
 * estado ainda gravado — é exatamente essa diferença que a tela precisa mostrar,
 * senão o balcão acha que a conversa está segurada quando não está mais.
 */
export function statusPausa(
  estado: string,
  pausadaAte: string | null,
  agora: Date = new Date(),
): Pausa {
  if (estado !== "aguardando_humano" || !pausadaAte) {
    return { pausada: false, minutosRestantes: 0 };
  }
  const restaMs = new Date(pausadaAte).getTime() - agora.getTime();
  if (!Number.isFinite(restaMs) || restaMs <= 0) {
    return { pausada: false, minutosRestantes: 0 };
  }
  return { pausada: true, minutosRestantes: Math.ceil(restaMs / 60_000) };
}

export function formatarRestante(minutos: number): string {
  if (minutos <= 0) return "";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Fila do balcão: quem está segurado no topo, o resto por movimento recente. */
export function ordenarConversas(rows: ConversaRow[], agora: Date = new Date()): ConversaRow[] {
  return [...rows].sort((a, b) => {
    const pa = statusPausa(a.estado, a.pausada_ate, agora).pausada ? 1 : 0;
    const pb = statusPausa(b.estado, b.pausada_ate, agora).pausada ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

// ─── Agrupamento por número ──────────────────────────────────────────────────

export type TurnoConsolidado = Turno & { conversaId: string; inicioDeConversa: boolean };

export type ConversaAgrupada = {
  /** Telefone só com dígitos; cai para cliente_id ou id quando não há telefone. */
  chave: string;
  /** Onde as ações agem: a que está segurada, ou a mais recente. */
  principal: ConversaRow;
  /** Todas as conversas do número, da mais recente para a mais antiga. */
  conversas: ConversaRow[];
  /** Histórico das várias conversas em ordem cronológica, do mais antigo ao mais novo. */
  historico: TurnoConsolidado[];
};

const soDigitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

/**
 * Um cliente vira VÁRIAS linhas em `conversas` — o `Insert_Conversa_HTTP` cria
 * uma nova sempre que a anterior está em `pedido_criado`, e o mesmo número já
 * acumulou 7 delas no banco. Sem agrupar, o balcão vê o mesmo cliente sete vezes
 * na lista e não sabe qual abrir; pior, pode devolver para a Maria uma conversa
 * velha enquanto a viva segue parada.
 *
 * A conversa "principal" é a que está segurada pelo balcão, se houver — é nela
 * que os botões precisam agir. Sem nenhuma segurada, é a de movimento mais recente.
 */
export function agruparPorTelefone(
  rows: ConversaRow[],
  agora: Date = new Date(),
): ConversaAgrupada[] {
  const mapa = new Map<string, ConversaRow[]>();

  for (const c of rows) {
    const chave = soDigitos(c.clientes?.telefone) || c.cliente_id || c.id;
    const lista = mapa.get(chave);
    if (lista) lista.push(c);
    else mapa.set(chave, [c]);
  }

  const grupos: ConversaAgrupada[] = [];

  for (const [chave, lista] of mapa) {
    const recentesPrimeiro = [...lista].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    const segurada = recentesPrimeiro.find((c) => statusPausa(c.estado, c.pausada_ate, agora).pausada);

    const historico: TurnoConsolidado[] = [];
    // Ordem cronológica para ler de cima para baixo, como qualquer conversa.
    for (const conversa of [...recentesPrimeiro].reverse()) {
      const turnos = parseHistorico(conversa.resumo_contexto);
      turnos.forEach((t, i) => {
        historico.push({ ...t, conversaId: conversa.id, inicioDeConversa: i === 0 });
      });
    }

    grupos.push({
      chave,
      principal: segurada ?? recentesPrimeiro[0],
      conversas: recentesPrimeiro,
      historico,
    });
  }

  // A ordem da fila é a mesma de sempre, aplicada às principais.
  const ordemPrincipais = ordenarConversas(grupos.map((g) => g.principal), agora);
  const posicao = new Map(ordemPrincipais.map((c, i) => [c.id, i]));
  return grupos.sort(
    (a, b) => (posicao.get(a.principal.id) ?? 0) - (posicao.get(b.principal.id) ?? 0),
  );
}

// ─── Busca de dados ──────────────────────────────────────────────────────────

export async function fetchConversas(): Promise<ConversaRow[]> {
  const { data, error } = await externalSupabase
    .from("conversas")
    .select(
      "id, cliente_id, estado, ultima_mensagem, resumo_contexto, pausada_ate, updated_at, clientes(nome, telefone, foto_url)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as ConversaRow[];
}

function horaCurta(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function Avatar({ nome, fotoUrl, telefone }: { nome: string | null; fotoUrl: string | null; telefone?: string }) {
  const iniciais = (nome ?? "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const candidatos = [fotoUrl?.trim() || null, fotoWhatsApp(telefone)].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  const src = candidatos[idx] ?? null;
  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden font-bold text-sm text-primary">
      {src
        ? <img key={src} src={src} alt="" className="w-full h-full object-cover" onError={() => setIdx((i) => i + 1)} />
        : iniciais}
    </div>
  );
}

function SeloQuemAtende({ pausa }: { pausa: Pausa }) {
  if (pausa.pausada) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-status-rua/15 text-status-ink-rua">
        <Headset className="w-3.5 h-3.5" />
        Balcão · Maria volta em {formatarRestante(pausa.minutosRestantes)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
      <Bot className="w-3.5 h-3.5" />
      Maria atendendo
    </span>
  );
}

// ─── Histórico ───────────────────────────────────────────────────────────────
function Bolha({ turno }: { turno: Turno }) {
  const ehCliente = turno.role === "cliente";
  const ehAtendente = turno.role === "atendente";
  const autor = ehCliente ? "Cliente" : ehAtendente ? "Atendente (balcão)" : "Maria";

  return (
    <div className={cn("flex flex-col gap-1", ehCliente ? "items-start" : "items-end")}>
      <span className={cn(
        "text-[11px] font-semibold",
        ehAtendente ? "text-status-ink-rua" : ehCliente ? "text-muted-foreground" : "text-primary",
      )}>
        {autor}
      </span>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
        ehCliente && "bg-secondary text-foreground rounded-tl-sm",
        ehAtendente && "bg-status-rua/15 text-foreground rounded-tr-sm",
        !ehCliente && !ehAtendente && "bg-primary/10 text-foreground rounded-tr-sm",
      )}>
        {turno.content}
      </div>
    </div>
  );
}

function ConversaDrawer({ grupo, open, onClose }: {
  grupo: ConversaAgrupada | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const conversa = grupo?.principal ?? null;
  const historico = grupo?.historico ?? [];
  const pausa = conversa ? statusPausa(conversa.estado, conversa.pausada_ate) : { pausada: false, minutosRestantes: 0 };
  const quantasConversas = grupo?.conversas.length ?? 0;

  const devolver = useMutation({
    mutationFn: async (estado: string) => {
      if (!conversa) return;
      const { data, error } = await externalSupabase.rpc("devolver_para_ana", {
        p_conversa_id: conversa.id,
        p_estado: estado,
      });
      if (error) throw error;
      if (data && (data as { ok?: boolean }).ok === false) {
        throw new Error((data as { motivo?: string }).motivo ?? "falhou");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversas"] });
      toast({
        title: "Devolvido para a Maria",
        description: "Ela responde de novo assim que o cliente mandar a próxima mensagem.",
      });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Não deu para devolver", description: e.message, variant: "destructive" }),
  });

  const pausar = useMutation({
    mutationFn: async () => {
      if (!conversa) return;
      const { data, error } = await externalSupabase.rpc("pausar_ana", { p_conversa_id: conversa.id });
      if (error) throw error;
      if (data && (data as { ok?: boolean }).ok === false) {
        throw new Error((data as { motivo?: string }).motivo ?? "falhou");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversas"] });
      toast({ title: "Maria pausada", description: "O atendimento é seu. Ela não responde este cliente até você devolver." });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Não deu para pausar", description: e.message, variant: "destructive" }),
  });

  const ocupado = devolver.isPending || pausar.isPending;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-3 text-left">
            <Avatar
              nome={conversa?.clientes?.nome ?? null}
              fotoUrl={conversa?.clientes?.foto_url ?? null}
              telefone={conversa?.clientes?.telefone}
            />
            <div className="min-w-0">
              <p className="font-display text-base font-extrabold truncate">
                {conversa?.clientes?.nome ?? "Cliente"}
              </p>
              <p className="text-xs font-normal text-muted-foreground">
                {conversa?.clientes?.telefone} · {ESTADO_LABEL[conversa?.estado ?? ""] ?? conversa?.estado}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 py-3 border-b border-border">
          <SeloQuemAtende pausa={pausa} />
          {pausa.pausada && conversa?.pausada_ate && (
            <p className="mt-2 text-xs text-muted-foreground">
              Se ninguém devolver, a Maria reassume sozinha às {horaCurta(conversa.pausada_ate)}.
            </p>
          )}
          {quantasConversas > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {quantasConversas} atendimentos deste número reunidos aqui. Os botões agem no
              atendimento atual.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem histórico gravado.</p>
          ) : (
            historico.map((t, i) => (
              <div key={`${t.conversaId}-${i}`} className="space-y-3">
                {/* Divisor só entre atendimentos: o primeiro turno da lista não
                    precisa de aviso de "outro atendimento". */}
                {t.inicioDeConversa && i > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      outro atendimento
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <Bolha turno={t} />
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-4 space-y-2">
          {pausa.pausada ? (
            <>
              <Button
                className="w-full"
                disabled={ocupado}
                onClick={() => devolver.mutate("entendendo_pedido")}
              >
                {devolver.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Devolver para a Maria
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={ocupado}
                onClick={() => devolver.mutate("novo_contato")}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Devolver e recomeçar do zero
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Ela retoma com todo o histórico acima, inclusive o que você escreveu.
                Nada é enviado ao cliente agora.
              </p>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full"
                disabled={ocupado || conversa?.estado === "pedido_criado"}
                onClick={() => pausar.mutate()}
              >
                {pausar.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pause className="w-4 h-4 mr-2" />}
                Assumir eu mesmo (pausar a Maria)
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Digitar para o cliente no celular da farmácia já faz isso sozinho.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Página / aba ────────────────────────────────────────────────────────────

/**
 * `embutido` = renderizada como aba dentro de /pedidos, que já tem o próprio
 * cabeçalho e a própria busca. A rota /conversas antiga redireciona para lá.
 */
export default function Conversas({ embutido = false }: { embutido?: boolean }) {
  const [busca, setBusca] = useState("");
  const [soBalcao, setSoBalcao] = useState(false);
  const [abertaChave, setAbertaChave] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["conversas"],
    queryFn: fetchConversas,
    // `conversas` não está na publication de realtime (só `pedidos` e
    // `despacho_entrega`), então a tela se atualiza por poll.
    refetchInterval: POLL_MS,
  });

  const grupos = useMemo(() => agruparPorTelefone(data ?? []), [data]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return grupos.filter((g) => {
      const p = g.principal;
      if (soBalcao && !statusPausa(p.estado, p.pausada_ate).pausada) return false;
      if (!termo) return true;
      return (
        (p.clientes?.nome ?? "").toLowerCase().includes(termo) ||
        (p.clientes?.telefone ?? "").includes(termo)
      );
    });
  }, [grupos, busca, soBalcao]);

  const emEspera = useMemo(
    () => grupos.filter((g) => statusPausa(g.principal.estado, g.principal.pausada_ate).pausada).length,
    [grupos],
  );

  // O drawer lê da lista viva para não mostrar dados velhos depois de um refetch.
  const grupoAberto = abertaChave ? grupos.find((g) => g.chave === abertaChave) ?? null : null;

  return (
    <div className={embutido ? "p-4" : "p-4 md:p-8"}>
      <div className="max-w-3xl mx-auto">
        {!embutido && (
          <div className="flex items-center gap-3 mb-6">
            <MessagesSquare className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Conversas</h1>
            {emEspera > 0 && (
              <Badge className="ml-auto bg-status-rua/15 text-status-ink-rua hover:bg-status-rua/15">
                {emEspera} com o balcão
              </Badge>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant={soBalcao ? "default" : "outline"}
            onClick={() => setSoBalcao((v) => !v)}
            className="shrink-0"
          >
            <Headset className="w-4 h-4 mr-2" />
            Só as do balcão
          </Button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive text-center py-8">
            Não deu para carregar as conversas.
          </p>
        )}

        {!isLoading && !error && lista.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            {soBalcao ? "Nenhuma conversa com o balcão agora." : "Nenhuma conversa por aqui."}
          </p>
        )}

        <div className="space-y-2">
          {lista.map((g) => {
            const c = g.principal;
            const pausa = statusPausa(c.estado, c.pausada_ate);
            return (
              <button
                key={g.chave}
                onClick={() => setAbertaChave(g.chave)}
                className={cn(
                  "w-full text-left rounded-xl border bg-card p-3 transition-colors hover:bg-secondary/60",
                  pausa.pausada ? "border-status-rua/40" : "border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    nome={c.clientes?.nome ?? null}
                    fotoUrl={c.clientes?.foto_url ?? null}
                    telefone={c.clientes?.telefone}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">
                        {c.clientes?.nome ?? c.clientes?.telefone ?? "Cliente"}
                      </p>
                      {g.conversas.length > 1 && (
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                          {g.conversas.length} atendimentos
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                        <Clock className="w-3 h-3" />
                        {horaCurta(c.updated_at)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {c.ultima_mensagem || ESTADO_LABEL[c.estado] || c.estado}
                    </p>
                    <div className="mt-2">
                      <SeloQuemAtende pausa={pausa} />
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <ConversaDrawer
        grupo={grupoAberto}
        open={!!abertaChave}
        onClose={() => setAbertaChave(null)}
      />
    </div>
  );
}
