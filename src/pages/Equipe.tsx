import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bike, Store, Loader2, KeyRound, Phone, Power, UserPlus, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase, pinToPassword } from "@/integrations/supabase/external-client";
import PinInput from "@/components/PinInput";
import { brl, moneyClass } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  emailDoMembro, iniciais, telefoneCurto,
  ROTULO_FUNCAO, TABELA_DA_FUNCAO,
  type Funcao, type MembroEquipe,
} from "@/lib/equipe";

/**
 * Equipe — quem tem login no painel, entregadores e balcão no mesmo lugar.
 *
 * Antes o cadastro era uma sub-aba de /entregadores, o que só dava conta de quem
 * anda de moto: não havia onde criar login para quem fica no balcão. A hierarquia
 * foi invertida — Equipe é a seção, entregador e balcão são as duas funções dentro
 * dela. /entregadores voltou a ser só monitoramento (Ao vivo + Histórico).
 *
 * As duas funções gravam em tabelas diferentes de propósito — ver `src/lib/equipe.ts`.
 */

type ItemPagamento = { forma: string; valor: number };

type DespachoMetrica = {
  entregador_id: string | null;
  saiu_em: string | null;
  entregue_em: string | null;
  status_entrega: string;
  pagamento_recebido: ItemPagamento[] | null;
  pedidos: { status: string | null } | null;
};

async function fetchMembros(funcao: Funcao): Promise<MembroEquipe[]> {
  const { data, error } = await externalSupabase
    .from(TABELA_DA_FUNCAO[funcao])
    .select("id, nome, telefone, ativo, user_id")
    .order("nome");
  if (error) throw error;
  return (data ?? []) as MembroEquipe[];
}

/** Só o necessário para as métricas — o monitor completo mora em /entregadores. */
async function fetchDespachosMetrica(): Promise<DespachoMetrica[]> {
  const { data, error } = await externalSupabase
    .from("despacho_entrega")
    .select("entregador_id, saiu_em, entregue_em, status_entrega, pagamento_recebido, pedidos(status)");
  if (error) throw error;
  return (data ?? []) as unknown as DespachoMetrica[];
}

function minutosEntre(inicio: string | null, fim: string | null) {
  if (!inicio || !fim) return null;
  return (new Date(fim).getTime() - new Date(inicio).getTime()) / 60000;
}

function duracaoCurta(min: number | null) {
  if (min == null) return "—";
  if (min < 1) return "<1min";
  if (min < 60) return `${Math.floor(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return m ? `${h}h${m}` : `${h}h`;
}

function metricasDe(entregadorId: string, despachos: DespachoMetrica[]) {
  const meus = despachos.filter((d) => d.entregador_id === entregadorId);
  const entregues = meus.filter((d) => d.entregue_em);
  const hoje = new Date().toDateString();
  const entreguesHoje = entregues.filter((d) => new Date(d.entregue_em!).toDateString() === hoje);
  const emAndamento = meus.filter((d) => {
    const st = d.pedidos?.status;
    if (st === "cancelado" || st === "entregue" || st === "retirado") return false;
    return !d.entregue_em && d.status_entrega !== "entregue";
  });

  const tempos = entregues
    .map((d) => minutosEntre(d.saiu_em, d.entregue_em))
    .filter((t): t is number => t != null && t >= 0);
  const tempoMedio = tempos.length ? tempos.reduce((s, t) => s + t, 0) / tempos.length : null;

  const recebido = entregues.reduce(
    (s, d) => s + (d.pagamento_recebido ?? []).reduce((x, p) => x + (Number(p.valor) || 0), 0),
    0,
  );

  return {
    total: entregues.length,
    entreguesHoje: entreguesHoje.length,
    emAndamento: emAndamento.length,
    tempoMedio,
    recebido,
  };
}

// ─── Lista de uma função ──────────────────────────────────────────────────────

function ListaEquipe({ funcao, despachos }: { funcao: Funcao; despachos: DespachoMetrica[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tabela = TABELA_DA_FUNCAO[funcao];
  const ehEntregador = funcao === "entregador";

  const { data: membros, isLoading } = useQuery({
    queryKey: ["equipe", funcao],
    queryFn: () => fetchMembros(funcao),
  });

  const [pinAberto, setPinAberto] = useState<MembroEquipe | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTel, setNovoTel] = useState("");
  const [novoPin, setNovoPin] = useState(["", "", "", ""]);

  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const novoPinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  function recarregar() {
    qc.invalidateQueries({ queryKey: ["equipe", funcao] });
    // O monitor de /entregadores e o despacho leem a mesma lista de entregadores.
    if (ehEntregador) qc.invalidateQueries({ queryKey: ["monitor-entregadores"] });
    // A tela de login mostra os cards de quem está ativo.
    qc.invalidateQueries({ queryKey: ["equipe-login"] });
  }

  function abrirPin(m: MembroEquipe) {
    setPinAberto(m);
    setPin(["", "", "", ""]);
    setTimeout(() => pinRefs[0].current?.focus(), 100);
  }

  async function salvarLogin() {
    if (!pinAberto) return;
    const pinStr = pin.join("");
    if (pinStr.length < 4) {
      toast({ title: "PIN incompleto", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/create-entregador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailDoMembro(pinAberto.telefone),
          password: pinToPassword(pinStr),
          ...(pinAberto.user_id ? { userId: pinAberto.user_id } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.msg ?? result.error ?? "Erro na API");
      if (!pinAberto.user_id) {
        if (!result.id) throw new Error("user_id não retornado.");
        const { error } = await externalSupabase
          .from(tabela).update({ user_id: result.id }).eq("id", pinAberto.id);
        if (error) throw new Error(error.message);
      }
      toast({
        title: pinAberto.user_id
          ? `PIN redefinido para ${pinAberto.nome}`
          : `Login criado para ${pinAberto.nome}`,
      });
      recarregar();
      setPinAberto(null);
    } catch (err: unknown) {
      toast({
        title: "Erro ao salvar login",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function cadastrar() {
    if (!novoNome.trim() || !novoTel.trim()) {
      toast({ title: "Nome e telefone são obrigatórios", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const tel = novoTel.replace(/\D/g, "");
      const { data: inserted, error } = await externalSupabase
        .from(tabela)
        .insert({ nome: novoNome.trim(), telefone: tel, ativo: true })
        .select()
        .single();
      if (error) throw new Error(error.message);

      const pinStr = novoPin.join("");
      if (pinStr.length === 4 && inserted) {
        const res = await fetch("/api/create-entregador", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailDoMembro(tel), password: pinToPassword(pinStr) }),
        });
        const result = await res.json();
        if (res.ok && result.id) {
          await externalSupabase.from(tabela).update({ user_id: result.id }).eq("id", inserted.id);
        } else {
          // Cadastrou a pessoa mas o login falhou: precisa aparecer, senão ela
          // fica na lista sem conseguir entrar e ninguém entende por quê.
          toast({
            title: `${novoNome} cadastrado, mas sem login`,
            description: result.msg ?? result.error ?? "Defina o PIN de novo pelo botão do card.",
            variant: "destructive",
          });
        }
      }

      toast({ title: `${novoNome} cadastrado` });
      recarregar();
      setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]);
      setNovoAberto(false);
    } catch (err: unknown) {
      toast({
        title: "Erro ao cadastrar",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function alternarAtivo(m: MembroEquipe) {
    const { error } = await externalSupabase
      .from(tabela).update({ ativo: !m.ativo }).eq("id", m.id);
    if (error) {
      toast({ title: "Erro ao alterar status", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${m.nome} ${m.ativo ? "desativado" : "ativado"}` });
    recarregar();
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lista = membros ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {ehEntregador
            ? "Quem faz entrega. É desta lista que o balcão escolhe o motoboy ao despachar."
            : "Quem atende no balcão. Entra no painel com os mesmos acessos do admin e nunca recebe entrega."}
        </p>
        <Button size="sm" className="shrink-0" onClick={() => {
          setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]); setNovoAberto(true);
        }}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          Novo {ehEntregador ? "entregador" : "atendente"}
        </Button>
      </div>

      {lista.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-10">
          Ninguém cadastrado em {ROTULO_FUNCAO[funcao].toLowerCase()} ainda.
        </p>
      )}

      {lista.map((m) => {
        const metricas = ehEntregador ? metricasDe(m.id, despachos) : null;
        return (
          <div key={m.id} className={cn("bg-card border rounded-xl p-4", m.ativo ? "border-border" : "border-border opacity-60")}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                metricas?.emAndamento ? "bg-violet-600 text-white" : "bg-primary/10 text-primary",
              )}>
                {iniciais(m.nome)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground truncate">{m.nome}</p>
                  {metricas && metricas.emAndamento > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      {metricas.emAndamento} na rua
                    </span>
                  )}
                  {!m.ativo && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      Inativo
                    </span>
                  )}
                  {m.user_id
                    ? <span className="text-[10px] text-money font-medium">● Login ativo</span>
                    : <span className="text-[10px] text-status-ink-separacao font-medium">● Sem login</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{telefoneCurto(m.telefone)}</p>
              </div>
            </div>

            {metricas && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Entregues</p>
                  <p className="text-sm font-bold">{metricas.total}</p>
                </div>
                <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Hoje</p>
                  <p className="text-sm font-bold">{metricas.entreguesHoje}</p>
                </div>
                <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Tempo médio</p>
                  <p className="text-sm font-bold">{duracaoCurta(metricas.tempoMedio)}</p>
                </div>
                <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Recebido</p>
                  <p className={cn("text-sm", moneyClass(metricas.recebido))}>{brl(metricas.recebido)}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => abrirPin(m)}>
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                {m.user_id ? "Redefinir PIN" : "Criar login"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => alternarAtivo(m)}>
                <Power className="w-3.5 h-3.5 mr-1.5" />
                {m.ativo ? "Desativar" : "Ativar"}
              </Button>
              <a
                href={`https://wa.me/${m.telefone.replace(/\D/g, "")}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-status-entregue/10 text-status-ink-entregue hover:bg-status-entregue/20 border border-status-entregue/25 transition-colors"
              >
                <Phone className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
              </a>
            </div>
          </div>
        );
      })}

      {/* Modal PIN */}
      <Dialog open={!!pinAberto} onOpenChange={(v) => { if (!v) setPinAberto(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinAberto?.user_id ? "Redefinir PIN" : "Criar login"}</DialogTitle>
          </DialogHeader>
          {pinAberto && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold">{pinAberto.nome}</p>
                <p className="text-xs text-muted-foreground">{telefoneCurto(pinAberto.telefone)}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {pinAberto.user_id ? "Novo PIN de 4 dígitos" : "Defina um PIN de 4 dígitos"}
                </p>
                <PinInput pin={pin} setPin={setPin} pinRefs={pinRefs} />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setPinAberto(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={salvarLogin} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal novo membro */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo {ehEntregador ? "entregador" : "atendente do balcão"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="eq-nome">Nome</Label>
              <Input id="eq-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eq-tel">Telefone (WhatsApp)</Label>
              <Input id="eq-tel" value={novoTel} onChange={(e) => setNovoTel(e.target.value)} placeholder="5521900000000" type="tel" />
              <p className="text-xs text-muted-foreground">
                É o telefone que vira o login: {novoTel.replace(/\D/g, "") ? emailDoMembro(novoTel) : "numero@farmaciavital.internal"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>PIN de acesso (opcional)</Label>
              <PinInput pin={novoPin} setPin={setNovoPin} pinRefs={novoPinRefs} />
              <p className="text-xs text-muted-foreground text-center">Pode ser definido depois</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setNovoAberto(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={cadastrar} disabled={loading || !novoNome.trim() || !novoTel.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cadastrar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

const ABAS: { key: Funcao; label: string; icon: React.ReactNode }[] = [
  { key: "entregador", label: "Entregadores", icon: <Bike className="w-4 h-4" /> },
  { key: "balcao", label: "Balcão", icon: <Store className="w-4 h-4" /> },
];

export default function Equipe() {
  const [aba, setAba] = useState<Funcao>("entregador");

  // Uma busca só, usada pelas métricas dos entregadores.
  const { data: despachos } = useQuery({
    queryKey: ["equipe-despachos"],
    queryFn: fetchDespachosMetrica,
    staleTime: 60_000,
  });

  const lista = useMemo(() => despachos ?? [], [despachos]);

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <Users className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Equipe</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Cadastro e login de quem trabalha na farmácia.
        </p>

        <div className="flex gap-1 mb-4">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                aba === a.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>

        <ListaEquipe funcao={aba} despachos={lista} />
      </div>
    </div>
  );
}
