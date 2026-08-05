import { externalSupabase } from "@/integrations/supabase/external-client";

/**
 * Taxa de entrega por distância — lado do painel.
 *
 * A REGRA NÃO MORA AQUI: ela mora em `configuracoes.frete_entrega`, a mesma linha que o nó
 * `Calcular_Frete` (Ana_Agente) lê a cada pedido do WhatsApp. Este arquivo só aplica o que
 * está lá. Mudar preço ou limite é editar aquele JSON — não este código.
 *
 * O que este arquivo deliberadamente NÃO faz: geocodificar. O n8n usa Nominatim/OSM, que não
 * conhece metade das ruas de Araruama, e a coordenada boa vem do pin do WhatsApp — que não
 * existe no pedido de balcão. Aqui a distância é informada por quem está atendendo.
 * (Ver a lição registrada: o painel já divergiu do workflow duas vezes por recriar regra dele.)
 */

const CHAVE = "frete_entrega";

export type FreteConfig = {
  ativo: boolean;
  raio_base_km: number;
  taxa_base: number;
  taxa_por_km_extra: number;
  limite_km: number;
  arredondamento?: string;
};

/** Usado só se a linha `frete_entrega` sumir do banco — mantém o balcão trabalhando. */
export const FRETE_PADRAO: FreteConfig = {
  ativo: true,
  raio_base_km: 2,
  taxa_base: 2,
  taxa_por_km_extra: 1,
  limite_km: 15,
};

export async function carregarFreteConfig(): Promise<FreteConfig> {
  const { data, error } = await externalSupabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", CHAVE)
    .maybeSingle();

  if (error || !data) return FRETE_PADRAO;
  try {
    // `configuracoes.valor` é text com JSON dentro, não jsonb.
    return { ...FRETE_PADRAO, ...JSON.parse(data.valor) };
  } catch {
    return FRETE_PADRAO;
  }
}

export type ResultadoFrete = {
  taxa: number;
  /** true quando a distância passa do limite: a farmácia não entrega, sem exceção. */
  foraDeArea: boolean;
};

/**
 * R$ `taxa_base` até `raio_base_km`; acima disso, + `taxa_por_km_extra` por **km iniciado**
 * (`ceil`, não `floor`). Acima de `limite_km` não entrega.
 *
 * Espelha o `Calcular_Frete` do n8n. Se um dia a regra mudar lá, muda aqui junto.
 */
export function calcularTaxa(km: number | null, cfg: FreteConfig): ResultadoFrete {
  if (km === null || !Number.isFinite(km) || km <= 0) {
    return { taxa: cfg.taxa_base, foraDeArea: false };
  }
  if (km > cfg.limite_km) return { taxa: 0, foraDeArea: true };
  if (km <= cfg.raio_base_km) return { taxa: cfg.taxa_base, foraDeArea: false };

  const extras = Math.ceil(km - cfg.raio_base_km);
  return { taxa: cfg.taxa_base + extras * cfg.taxa_por_km_extra, foraDeArea: false };
}
