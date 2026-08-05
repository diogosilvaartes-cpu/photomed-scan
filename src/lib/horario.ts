/**
 * Horário de funcionamento — o lado do painel.
 *
 * ⚠️ A REGRA MORA NA CONFIG, NÃO AQUI. Tudo (semana, exceções, override,
 * kill-switch) vem de `configuracoes.horario_funcionamento`, a mesma linha que o
 * n8n lê a cada mensagem do WhatsApp. Este arquivo só sabe *interpretar* a
 * config; mudar horário é editar o JSON no banco, nunca este código.
 *
 * `calcHorario` é uma tradução 1-para-1 de `N8N FARMA/AGENDAMENTO/calc_horario.js`,
 * que é injetado nos Code nodes `Montar_Prompt` e `AGL_Esta_Aberta`. As duas
 * cópias precisam concordar: se divergirem, o painel mostra "aberta" enquanto a
 * Ana manda o cliente agendar. Ao mexer numa, mexer na outra —
 * `src/test/horario.test.ts` guarda os casos de borda.
 */

export type FaixaHorario = [string, string];

export interface ConfigHorario {
  timezone?: string;
  utc_offset?: number;
  agendamento_ativo?: boolean;
  expira_confirmacao_horas?: number;
  semana: Record<string, FaixaHorario[]>;
  excecoes?: Record<string, FaixaHorario[]>;
  override?: { ativo: boolean; aberto: boolean; ate: string | null };
}

export interface EstadoHorario {
  ok: boolean;
  /** O que vale de verdade — já com o override aplicado. */
  aberta: boolean;
  /** O que a tabela semanal diz, ignorando o override. É a diferença entre os dois que revela "forçado". */
  aberta_natural: boolean;
  /** Override ligado E ainda dentro da validade. */
  forcado: boolean;
  fechada: boolean;
  ativo: boolean;
  /** "hoje as 08:00", "amanha as 08:00", "segunda-feira as 08:00". */
  texto: string;
  abre_em: string | null;
  agora_local: string;
}

const DIAS = [
  "domingo", "segunda-feira", "terca-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sabado",
];

const toMin = (h: string) => {
  const p = String(h).split(":");
  return Number(p[0]) * 60 + Number(p[1] || 0);
};

export function parseConfig(raw: unknown): ConfigHorario | null {
  let cfg = raw;
  if (typeof cfg === "string") {
    try { cfg = JSON.parse(cfg); } catch { return null; }
  }
  const c = cfg as ConfigHorario | null;
  return c && c.semana ? c : null;
}

function faixasDe(cfg: ConfigHorario, dataIso: string, dow: number): FaixaHorario[] {
  if (cfg.excecoes && cfg.excecoes[dataIso] !== undefined) return cfg.excecoes[dataIso];
  return cfg.semana[String(dow)] || [];
}

export function calcHorario(cfgRaw: unknown, nowMs: number = Date.now()): EstadoHorario {
  const cfg = parseConfig(cfgRaw);

  // FAIL-SAFE idêntico ao do n8n: config ausente/quebrada => trata como ABERTA.
  // Errar para "aberta" perde o agendamento; errar para "fechada" recusa venda.
  if (!cfg) {
    return {
      ok: false, aberta: true, aberta_natural: true, forcado: false,
      fechada: false, ativo: false, texto: "", abre_em: null, agora_local: "",
    };
  }

  const off = Number(cfg.utc_offset === undefined ? -3 : cfg.utc_offset);
  // Hora local carregada nos campos UTC — mesmo truque do Code node, para não
  // depender do fuso da máquina que roda o código.
  const loc = new Date(nowMs + off * 3600000);
  const dow = loc.getUTCDay();
  const data = loc.toISOString().slice(0, 10);
  const min = loc.getUTCHours() * 60 + loc.getUTCMinutes();

  const natural = faixasDe(cfg, data, dow).some((f) => min >= toMin(f[0]) && min < toMin(f[1]));

  let aberta = natural;
  let forcado = false;
  if (cfg.override && cfg.override.ativo) {
    const ate = cfg.override.ate ? Date.parse(cfg.override.ate) : null;
    if (!ate || nowMs < ate) {
      aberta = cfg.override.aberto === true;
      forcado = true;
    }
  }

  let prox: { data: string; hora: string; dias: number; dow: number } | null = null;
  for (let d = 0; d < 8 && !prox; d++) {
    const dia = new Date(loc.getTime() + d * 86400000);
    const key = dia.toISOString().slice(0, 10);
    const dw = dia.getUTCDay();
    for (const f of faixasDe(cfg, key, dw)) {
      if (d > 0 || toMin(f[0]) > min) { prox = { data: key, hora: f[0], dias: d, dow: dw }; break; }
    }
  }

  const texto = !prox ? "em breve"
    : prox.dias === 0 ? `hoje as ${prox.hora}`
      : prox.dias === 1 ? `amanha as ${prox.hora}`
        : `${DIAS[prox.dow]} as ${prox.hora}`;

  const abreEmIso = prox
    ? new Date(Date.parse(`${prox.data}T${prox.hora}:00.000Z`) - off * 3600000).toISOString()
    : null;

  return {
    ok: true,
    aberta,
    aberta_natural: natural,
    forcado,
    fechada: !aberta && cfg.agendamento_ativo !== false,
    ativo: cfg.agendamento_ativo !== false,
    texto,
    abre_em: abreEmIso,
    agora_local: loc.toISOString().slice(0, 16).replace("T", " "),
  };
}

/**
 * Quando o horário natural muda de estado pela próxima vez.
 *
 * Aberta agora → fim da faixa em curso (as 20:00 de hoje).
 * Fechada agora → início da próxima faixa (as 08:00 de amanhã).
 *
 * É o prazo de validade de um override manual: ele existe justamente para
 * discordar da tabela, e some no instante em que a tabela passa a concordar.
 */
export function proximaTransicao(cfgRaw: unknown, nowMs: number = Date.now()): string | null {
  const cfg = parseConfig(cfgRaw);
  if (!cfg) return null;

  const off = Number(cfg.utc_offset === undefined ? -3 : cfg.utc_offset);
  const loc = new Date(nowMs + off * 3600000);
  const data = loc.toISOString().slice(0, 10);
  const dow = loc.getUTCDay();
  const min = loc.getUTCHours() * 60 + loc.getUTCMinutes();

  const paraIso = (dataIso: string, hhmm: string) =>
    new Date(Date.parse(`${dataIso}T${hhmm}:00.000Z`) - off * 3600000).toISOString();

  // Dentro de uma faixa? A virada é o fim dela.
  const atual = faixasDe(cfg, data, dow).find((f) => min >= toMin(f[0]) && min < toMin(f[1]));
  if (atual) return paraIso(data, atual[1]);

  // Fora: a virada é a próxima abertura.
  return calcHorario(cfg, nowMs).abre_em;
}

/**
 * Config nova para o clique do balcão em "abrir"/"fechar".
 *
 * Função pura e exportada porque é onde mora o risco: um override sem `ate`
 * fica ligado para sempre, e "abri às 22h para um cliente" vira a Ana atendendo
 * todas as madrugadas. O `ate` é sempre a próxima virada natural.
 *
 * `abrir === null` limpa o override (volta ao automático).
 */
export function proximoOverride(
  cfgRaw: unknown,
  abrir: boolean | null,
  nowMs: number = Date.now(),
): ConfigHorario | null {
  const cfg = parseConfig(cfgRaw);
  if (!cfg) return null;

  if (abrir === null) {
    return { ...cfg, override: { ativo: false, aberto: true, ate: null } };
  }

  // Sem override, para calcular a virada da tabela e não da decisão anterior.
  const limpo: ConfigHorario = { ...cfg, override: { ativo: false, aberto: true, ate: null } };
  const natural = calcHorario(limpo, nowMs).aberta;

  // Clicou para o mesmo estado que a tabela já dá: não é override, é voltar ao
  // automático. Evita criar um override inútil que depois confunde quem lê.
  if (natural === abrir) {
    return { ...cfg, override: { ativo: false, aberto: true, ate: null } };
  }

  return {
    ...cfg,
    override: { ativo: true, aberto: abrir, ate: proximaTransicao(limpo, nowMs) },
  };
}
