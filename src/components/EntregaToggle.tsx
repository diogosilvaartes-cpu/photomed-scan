import { useCallback, useEffect, useState } from "react";
import { Bike, Loader2, Store } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Botão de "entrega disponível" — o balcão desliga quando o motoboy sai e liga quando volta.
 *
 * Lê e escreve `configuracoes.entrega_disponivel`, a mesma linha que o n8n consulta a cada
 * mensagem do WhatsApp (nó Buscar_Horario → Montar_Prompt). Desligado, a Maria para de
 * oferecer entrega e passa a oferecer retirada na loja.
 *
 * ⚠️ `ultimo_estado_aberta` NUNCA pode ser alterado daqui. Esse campo é do
 * WF_Agendamento_Liberar, que o usa para detectar a transição abre/fecha e sincronizar a
 * entrega sozinho. Se o painel o sobrescrever, o n8n enxerga uma transição falsa no tick
 * seguinte (≤5 min) e desfaz o clique do balcão.
 */

const CHAVE = "entrega_disponivel";
const POLL_MS = 30_000;

export type ConfigEntrega = {
  ativo: boolean;
  alterado_em: string | null;
  alterado_por: string | null;
  ultimo_estado_aberta?: boolean;
};

/**
 * Monta a linha que vai para o banco ao clicar no botão.
 * Função pura e exportada porque é aqui que mora a regra que mais dói se quebrar:
 * o spread preserva `ultimo_estado_aberta`. Ver o aviso no topo do arquivo.
 */
export function proximoEstadoEntrega(cfg: ConfigEntrega, agora = new Date()): ConfigEntrega {
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

export default function EntregaToggle({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { role } = useAuth();
  const [cfg, setCfg] = useState<ConfigEntrega | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(false);

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
    // `configuracoes` não está na publication de realtime — o n8n também mexe nessa linha
    // (abre/fecha automático), então vale reler de tempos em tempos e ao voltar para a aba.
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
    setSalvando(true);
    const novo = proximoEstadoEntrega(cfg);

    const { error } = await externalSupabase
      .from("configuracoes")
      .update({ valor: JSON.stringify(novo, null, 2) })
      .eq("chave", CHAVE);

    if (!error) setCfg(novo);
    else setErro(true);
    setSalvando(false);
  }

  const ligado = cfg?.ativo !== false;
  const porSistema = cfg?.alterado_por === "sistema";
  const quando = horaCurta(cfg?.alterado_em ?? null);

  // Estado de carregamento/erro: não pisca um estado errado para o balcão.
  if (!cfg) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-2xl border border-dashed text-xs font-semibold",
          variant === "sidebar"
            ? "mx-3 mb-1 h-[92px] border-sidebar-border text-sidebar-foreground/60"
            : "h-[62px] shrink-0 px-4 border-border text-muted-foreground"
        )}
      >
        {erro ? "entrega: indisponível" : <Loader2 className="w-4 h-4 animate-spin" />}
      </div>
    );
  }

  const Icone = ligado ? Bike : Store;

  const legenda = ligado
    ? "Toque para pausar"
    : porSistema
      ? "Pausada automaticamente"
      : "Toque para retomar";

  if (variant === "mobile") {
    return (
      <button
        type="button"
        onClick={alternar}
        disabled={!podeMexer || salvando}
        aria-pressed={ligado}
        className={cn(
          "flex flex-col items-center justify-center gap-1 shrink-0 w-[86px] h-[62px] rounded-xl border text-[11px] font-bold transition-colors",
          ligado
            ? "bg-[hsl(var(--money))] text-white border-transparent"
            : "bg-[hsl(var(--destructive))] text-white border-transparent",
          (!podeMexer || salvando) && "opacity-70"
        )}
      >
        {salvando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icone className="w-5 h-5" />}
        <span className="leading-none">{ligado ? "Entrega ON" : "Entrega OFF"}</span>
      </button>
    );
  }

  return (
    <div className="px-3 pb-3">
      <button
        type="button"
        onClick={alternar}
        disabled={!podeMexer || salvando}
        aria-pressed={ligado}
        title={podeMexer ? "Ligar/desligar entrega" : "Somente o balcão altera a entrega"}
        className={cn(
          "w-full rounded-2xl px-4 py-4 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          ligado
            ? "bg-[hsl(var(--money))] text-white hover:bg-[hsl(var(--money))]/90"
            : "bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90",
          (!podeMexer || salvando) && "cursor-default opacity-90 hover:bg-inherit"
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 shrink-0">
            {salvando ? <Loader2 className="w-6 h-6 animate-spin" /> : <Icone className="w-6 h-6" />}
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold leading-tight">
              {ligado ? "Entrega ON" : "Entrega OFF"}
            </p>
            <p className="text-xs font-semibold text-white/85 leading-tight">
              {ligado ? "Entregando normalmente" : "Só retirada na loja"}
            </p>
          </div>
        </div>

        {podeMexer && (
          <p className="mt-2.5 text-[11px] font-semibold text-white/75">
            {legenda}
            {quando ? ` · ${quando}` : ""}
          </p>
        )}
      </button>
    </div>
  );
}
