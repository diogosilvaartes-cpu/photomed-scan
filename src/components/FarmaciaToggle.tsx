import { useCallback, useEffect, useState } from "react";
import { DoorClosed, DoorOpen, Loader2, RotateCcw } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { calcHorario, proximoOverride, parseConfig, type ConfigHorario } from "@/lib/horario";
import { cn } from "@/lib/utils";

/**
 * Botão "Farmácia aberta" — o estado que decide se a Maria atende ou manda agendar.
 *
 * NORMALMENTE NINGUÉM PRECISA TOCAR NELE: o estado vem da tabela semanal em
 * `configuracoes.horario_funcionamento`, que abre às 08:00 e fecha às 20:00
 * sozinha. O botão existe para o dia em que a realidade discorda da tabela —
 * plantão de madrugada, falta de funcionário, feriado.
 *
 * O clique escreve `override` na MESMA config que o n8n lê a cada mensagem
 * (`Buscar_Horario` → `Montar_Prompt` no Ana_Agente, e o `IF_Fora_Horario` que
 * desvia para o agendamento). Por isso não há nada a fazer no n8n: ligado, a Maria
 * atende normalmente; desligado, ela informa o horário e oferece agendamento.
 *
 * ⚠️ O override SEMPRE nasce com prazo (`ate` = próxima virada da tabela). Sem
 * prazo, "abri às 22h para um cliente" viraria a Maria atendendo todas as
 * madrugadas seguintes, e ninguém lembraria de desligar. A regra mora em
 * `proximoOverride()`, coberta por `src/test/horario.test.ts`.
 *
 * ⚠️ Este componente NUNCA toca em `entrega_disponivel` — são dois estados
 * independentes, e quem sincroniza os dois é o `AGL_Calc_Transicao` do
 * WF_Agendamento_Liberar. Ver o aviso no topo de `EntregaToggle.tsx`.
 */

const CHAVE = "horario_funcionamento";
const POLL_MS = 30_000;

const horaCurta = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("pt-BR", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
      })
    : null;

export default function FarmaciaToggle({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "mobile" | "compacto";
}) {
  const { role } = useAuth();
  const [cfg, setCfg] = useState<ConfigHorario | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  // Só para o relógio: sem isto o card diria "aberta" depois das 20:00 até
  // alguém trocar de aba. O estado depende da HORA, não só do banco.
  const [agora, setAgora] = useState(() => Date.now());

  const podeMexer = role === "admin";

  const carregar = useCallback(async () => {
    const { data, error } = await externalSupabase
      .from("configuracoes").select("valor").eq("chave", CHAVE).maybeSingle();

    if (error || !data) { setErro(true); return; }
    const parsed = parseConfig(data.valor);
    if (!parsed) { setErro(true); return; }
    setCfg(parsed);
    setErro(false);
  }, []);

  useEffect(() => {
    carregar();
    // O n8n não escreve nesta linha (só lê), mas outro atendente pode ter
    // clicado em outro aparelho — e o override vence sozinho na virada.
    const t = setInterval(() => { carregar(); setAgora(Date.now()); }, POLL_MS);
    const onFocus = () => { carregar(); setAgora(Date.now()); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [carregar]);

  async function gravar(novo: ConfigHorario) {
    setSalvando(true);
    const { error } = await externalSupabase
      .from("configuracoes")
      .update({ valor: JSON.stringify(novo, null, 2) })
      .eq("chave", CHAVE);
    if (!error) { setCfg(novo); setErro(false); } else setErro(true);
    setSalvando(false);
  }

  const h = cfg ? calcHorario(cfg, agora) : null;

  /**
   * Clique no botão. Se o destino concorda com a tabela, aplica direto (é só
   * voltar ao automático). Se discorda, pede confirmação — é o caso de "fora do
   * horário" que o balcão precisa assumir conscientemente.
   */
  function clicar() {
    if (!cfg || !h || salvando || !podeMexer) return;
    const destino = !h.aberta;
    if (destino === h.aberta_natural) {
      gravar(proximoOverride(cfg, destino, agora)!);
      return;
    }
    setPerguntando(true);
  }

  function confirmarForcar() {
    if (!cfg || !h) return;
    gravar(proximoOverride(cfg, !h.aberta, agora)!);
  }

  function voltarAoAutomatico() {
    if (!cfg) return;
    gravar(proximoOverride(cfg, null, agora)!);
  }

  // Carregando/erro: não pisca um estado errado — "aberta" errado custa venda,
  // "fechada" errado custa cliente.
  if (!cfg || !h) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-2xl border border-dashed text-xs font-semibold",
          variant === "sidebar" && "mx-3 mb-1 h-[92px] border-sidebar-border text-sidebar-foreground/60",
          variant === "compacto" && "mx-3 mb-1 h-8 border-sidebar-border text-sidebar-foreground/60",
          variant === "mobile" && "h-[62px] shrink-0 px-4 border-border text-muted-foreground",
        )}
      >
        {erro ? "horário: —" : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </div>
    );
  }

  const aberta = h.aberta;
  const Icone = aberta ? DoorOpen : DoorClosed;
  const ateQuando = horaCurta(cfg.override?.ate ?? null);

  if (variant === "compacto") {
    // `clicar` aplica direto quando o destino concorda com a tabela de horário e
    // levanta `perguntando` quando discorda — é o caso de assumir "fora do
    // horário" na mão. Aqui a pergunta cabe no próprio botão: o pill vira
    // CONFIRMAR e o segundo toque grava.
    return (
      <button
        type="button"
        onClick={perguntando ? confirmarForcar : clicar}
        onBlur={() => setPerguntando(false)}
        disabled={!podeMexer || salvando}
        aria-pressed={aberta}
        title={podeMexer ? "Abrir/fechar a farmácia" : "Somente o balcão altera"}
        className={cn(
          "mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
          "text-sidebar-foreground hover:bg-sidebar-accent/50",
          perguntando && "bg-amber-500/20",
          (!podeMexer || salvando) && "opacity-70",
        )}
      >
        {salvando
          ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          : <Icone className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">
          {perguntando ? (aberta ? "Fechar agora?" : "Abrir agora?") : "Farmácia"}
        </span>
        {/* Ponto discreto para o estado forçado na mão: sem ele, ninguém percebe
            que a loja está aberta/fechada por override em vez do horário. */}
        {!perguntando && h.forcado && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Forçado manualmente" />
        )}
        <span
          className={cn(
            "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold",
            perguntando
              ? "bg-amber-500 text-white"
              : aberta
                ? "bg-[hsl(var(--money))] text-white"
                : "bg-[hsl(var(--destructive))] text-white",
          )}
        >
          {perguntando ? "CONFIRMAR" : aberta ? "ABERTA" : "FECHADA"}
        </span>
      </button>
    );
  }

  const legenda = h.forcado
    ? `Manual até ${ateQuando ?? "novo aviso"}`
    : aberta
      ? "Segue o horário · fecha " + h.texto.replace(/^hoje as /, "às ")
      : `Segue o horário · abre ${h.texto}`;

  const dialogo = (
    <AlertDialog open={perguntando} onOpenChange={setPerguntando}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {aberta ? "Fechar a farmácia agora?" : "Abrir a farmácia fora do horário?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {aberta ? (
              <>
                Ainda é horário de funcionamento. Fechando, a Maria <b>para de aceitar
                pedidos</b>, informa o horário e oferece agendamento para a próxima
                abertura.
              </>
            ) : (
              <>
                A farmácia está fora do horário. Abrindo, a Maria passa a <b>atender
                normalmente</b>, como em qualquer dia útil.
              </>
            )}
            <br />
            <br />
            Vale até <b>{horaCurta(nextAte(cfg, agora)) ?? "a próxima virada"}</b>, quando
            o horário normal reassume sozinho. Dá para desfazer a qualquer momento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmarForcar}>
            {aberta ? "Fechar agora" : "Abrir agora"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "mobile") {
    return (
      <>
        <button
          type="button"
          onClick={clicar}
          disabled={!podeMexer || salvando}
          aria-pressed={aberta}
          className={cn(
            "flex flex-col items-center justify-center gap-1 shrink-0 w-[86px] h-[62px] rounded-xl border text-[11px] font-bold transition-colors relative",
            aberta
              ? "bg-primary text-primary-foreground border-transparent"
              : "bg-[hsl(var(--destructive))] text-white border-transparent",
            (!podeMexer || salvando) && "opacity-70",
          )}
        >
          {salvando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icone className="w-5 h-5" />}
          <span className="leading-none">{aberta ? "Aberta" : "Fechada"}</span>
          {h.forcado && (
            <span
              title="Estado manual"
              className="absolute top-1 right-1.5 text-[9px] font-black opacity-80"
            >
              M
            </span>
          )}
        </button>
        {dialogo}
      </>
    );
  }

  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        onClick={clicar}
        disabled={!podeMexer || salvando}
        aria-pressed={aberta}
        title={podeMexer ? "Abrir/fechar a farmácia" : "Somente o balcão altera"}
        className={cn(
          "w-full rounded-2xl px-4 py-4 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          aberta
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90",
          (!podeMexer || salvando) && "cursor-default opacity-90 hover:bg-inherit",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 shrink-0">
            {salvando ? <Loader2 className="w-6 h-6 animate-spin" /> : <Icone className="w-6 h-6" />}
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold leading-tight">
              {aberta ? "Farmácia ABERTA" : "Farmácia FECHADA"}
            </p>
            <p className="text-xs font-semibold text-white/85 leading-tight">
              {aberta ? "A Maria atende normalmente" : "A Maria oferece agendamento"}
            </p>
          </div>
        </div>

        <p className="mt-2.5 text-[11px] font-semibold text-white/75">{legenda}</p>
      </button>

      {/* Só aparece quando há o que desfazer — é a saída de quem esqueceu ligado. */}
      {h.forcado && podeMexer && (
        <button
          type="button"
          onClick={voltarAoAutomatico}
          disabled={salvando}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] font-bold text-sidebar-foreground/80 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Voltar ao horário automático
        </button>
      )}

      {dialogo}
    </div>
  );
}

/** Prazo que o clique vai gravar — mostrado na confirmação antes de gravar. */
function nextAte(cfg: ConfigHorario, agora: number): string | null {
  const h = calcHorario(cfg, agora);
  return proximoOverride(cfg, !h.aberta, agora)?.override?.ate ?? null;
}
