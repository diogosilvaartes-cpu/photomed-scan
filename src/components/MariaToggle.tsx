import { useCallback, useEffect, useState } from "react";
import { Bot, BotOff, Loader2 } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Liga/desliga GERAL da atendente virtual — o freio de mão do balcão.
 *
 * Lê e escreve `configuracoes.maria_ativa`, a mesma linha que o n8n consulta a
 * cada mensagem (nó `Extrair_Conversa` → `IF_Ana_Pausada`, no Ana_Agente).
 *
 * Desligada, a Maria fica **muda**: a mensagem do cliente continua sendo
 * registrada e aparece na aba Conversas, mas nenhuma resposta automática sai.
 * É diferente das outras duas pausas que já existem:
 *  · handoff humano  -> cala em UMA conversa, volta sozinha em 2h
 *  · `clientes.maria_ativa` -> cala para UM cliente, permanente
 *  · esta            -> cala em TODAS as conversas, até alguém religar
 *
 * O n8n é fail-safe: se a leitura da config falhar, a Maria continua ligada. Ou
 * seja, este botão só desliga quando o banco confirma — nunca por acidente.
 */

const CHAVE = "maria_ativa";
const POLL_MS = 30_000;

export type ConfigMaria = {
  ativo: boolean;
  alterado_em: string | null;
  alterado_por: string | null;
};

/** Função pura — o mesmo formato que o n8n espera ler de volta. */
export function proximoEstadoMaria(cfg: ConfigMaria, agora = new Date()): ConfigMaria {
  return {
    ...cfg,
    ativo: !cfg.ativo,
    alterado_em: agora.toISOString(),
    alterado_por: "balcao",
  };
}

function horaCurta(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default function MariaToggle({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "mobile" | "compacto";
}) {
  const { role } = useAuth();
  const [cfg, setCfg] = useState<ConfigMaria | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const podeMexer = role === "admin";

  const carregar = useCallback(async () => {
    const { data, error } = await externalSupabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", CHAVE)
      .maybeSingle();

    if (error || !data) {
      setErro(true);
      return;
    }
    try {
      setCfg(JSON.parse(data.valor));
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    carregar();
    // `configuracoes` não está na publication de realtime, e mais de uma pessoa
    // mexe nessa linha — vale reler de tempos em tempos e ao voltar para a aba.
    const t = setInterval(carregar, POLL_MS);
    const onFocus = () => carregar();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [carregar]);

  async function alternar() {
    if (!cfg || salvando || !podeMexer) return;

    // Desligar a Maria para TODO MUNDO é a ação mais cara do painel: o WhatsApp
    // fica sem resposta e ninguém percebe até um cliente reclamar. Religar não
    // precisa de confirmação — errar para o lado de atender é barato.
    if (cfg.ativo && !confirmar) {
      setConfirmar(true);
      return;
    }

    setSalvando(true);
    const novo = proximoEstadoMaria(cfg);

    const { error } = await externalSupabase
      .from("configuracoes")
      .update({ valor: JSON.stringify(novo, null, 2) })
      .eq("chave", CHAVE);

    if (!error) setCfg(novo);
    else setErro(true);
    setSalvando(false);
    setConfirmar(false);
  }

  const ligada = cfg?.ativo !== false;
  const quando = horaCurta(cfg?.alterado_em ?? null);

  if (!cfg) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-2xl border border-dashed text-xs font-semibold",
          variant === "sidebar" && "mx-3 mb-1 h-[92px] border-sidebar-border text-sidebar-foreground/60",
          variant === "compacto" && "mx-3 mb-1 h-8 border-sidebar-border text-sidebar-foreground/60",
          variant === "mobile" && "h-[62px] shrink-0 px-4 border-border text-muted-foreground",
        )}
      >
        {erro ? "Maria: —" : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
    );
  }

  const Icone = ligada ? Bot : BotOff;

  // Linha fina para o rodapé da sidebar: o estado inteiro cabe num pill à
  // direita, e o bloco grande só existia porque isto ficava no topo.
  if (variant === "compacto") {
    return (
      <button
        type="button"
        onClick={alternar}
        onBlur={() => setConfirmar(false)}
        disabled={!podeMexer || salvando}
        aria-pressed={ligada}
        title={podeMexer ? "Ligar/desligar a Maria em todos os atendimentos" : "Somente o balcão altera"}
        className={cn(
          "mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
          "text-sidebar-foreground hover:bg-sidebar-accent/50",
          confirmar && "bg-destructive/20",
          (!podeMexer || salvando) && "opacity-70",
        )}
      >
        {salvando ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Icone className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{confirmar ? "Desligar tudo?" : "Maria"}</span>
        <span
          className={cn(
            "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold",
            ligada ? "bg-[hsl(var(--money))] text-white" : "bg-[hsl(var(--destructive))] text-white",
          )}
        >
          {confirmar ? "CONFIRMAR" : ligada ? "ON" : "OFF"}
        </span>
      </button>
    );
  }

  if (variant === "mobile") {
    return (
      <button
        type="button"
        onClick={alternar}
        onBlur={() => setConfirmar(false)}
        disabled={!podeMexer || salvando}
        aria-pressed={ligada}
        className={cn(
          "flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-bold transition-colors",
          "h-[62px] w-[86px]",
          ligada
            ? "border-transparent bg-[hsl(var(--money))] text-white"
            : "border-transparent bg-[hsl(var(--destructive))] text-white",
          confirmar && "ring-2 ring-white",
          (!podeMexer || salvando) && "opacity-70",
        )}
      >
        {salvando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icone className="h-5 w-5" />}
        <span className="leading-none">
          {confirmar ? "Confirmar?" : ligada ? "Maria ON" : "Maria OFF"}
        </span>
      </button>
    );
  }

  return (
    <div className="px-3 pb-3">
      <button
        type="button"
        onClick={alternar}
        onBlur={() => setConfirmar(false)}
        disabled={!podeMexer || salvando}
        aria-pressed={ligada}
        title={podeMexer ? "Ligar/desligar a Maria em todos os atendimentos" : "Somente o balcão altera"}
        className={cn(
          "w-full rounded-2xl px-4 py-4 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          ligada
            ? "bg-[hsl(var(--money))] text-white hover:bg-[hsl(var(--money))]/90"
            : "bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90",
          (!podeMexer || salvando) && "cursor-default opacity-90 hover:bg-inherit",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
            {salvando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icone className="h-6 w-6" />}
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold leading-tight">
              {ligada ? "Maria ON" : "Maria OFF"}
            </p>
            <p className="text-xs font-semibold leading-tight text-white/85">
              {ligada ? "Atendendo no WhatsApp" : "Ninguém está sendo respondido"}
            </p>
          </div>
        </div>

        {podeMexer && (
          <p className="mt-2.5 text-[11px] font-semibold text-white/75">
            {confirmar
              ? "Toque de novo para desligar TODOS os atendimentos"
              : ligada
                ? "Toque para desligar"
                : "Toque para religar"}
            {!confirmar && quando ? ` · ${quando}` : ""}
          </p>
        )}
      </button>
    </div>
  );
}
