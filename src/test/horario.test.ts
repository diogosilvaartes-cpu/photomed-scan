import { describe, it, expect } from "vitest";
import { calcHorario, proximaTransicao, proximoOverride, type ConfigHorario } from "@/lib/horario";

/**
 * A regra do horário mora na config, mas a INTERPRETAÇÃO dela existe em dois
 * lugares: aqui e no `calc_horario.js` injetado nos Code nodes do n8n. Estes
 * testes são o que impede as duas de divergirem em silêncio — o sintoma seria o
 * painel dizendo "aberta" enquanto a Ana manda o cliente agendar.
 */

// Horário real da farmácia: 8–20 seg-sex, 8–14 sáb, domingo fechado.
const CFG: ConfigHorario = {
  utc_offset: -3,
  agendamento_ativo: true,
  semana: {
    "0": [],
    "1": [["08:00", "20:00"]],
    "2": [["08:00", "20:00"]],
    "3": [["08:00", "20:00"]],
    "4": [["08:00", "20:00"]],
    "5": [["08:00", "20:00"]],
    "6": [["08:00", "14:00"]],
  },
  excecoes: {},
  override: { ativo: false, aberto: true, ate: null },
};

/** Quarta-feira, 05/08/2026, na hora local informada (UTC-3). */
const quarta = (hhmm: string) => Date.parse(`2026-08-05T${hhmm}:00.000-03:00`);

describe("calcHorario", () => {
  it("aberta dentro da faixa", () => {
    expect(calcHorario(CFG, quarta("14:00")).aberta).toBe(true);
  });

  it("fechada antes de abrir e depois de fechar", () => {
    expect(calcHorario(CFG, quarta("07:59")).aberta).toBe(false);
    expect(calcHorario(CFG, quarta("20:00")).aberta).toBe(false);
  });

  it("o fim da faixa é exclusivo: 19:59 aberta, 20:00 fechada", () => {
    expect(calcHorario(CFG, quarta("19:59")).aberta).toBe(true);
    expect(calcHorario(CFG, quarta("20:00")).aberta).toBe(false);
  });

  it("domingo fechado o dia inteiro", () => {
    const domingo = Date.parse("2026-08-09T12:00:00.000-03:00");
    expect(calcHorario(CFG, domingo).aberta).toBe(false);
  });

  it("exceção por data ganha da semana", () => {
    const cfg = { ...CFG, excecoes: { "2026-08-05": [] as [string, string][] } };
    expect(calcHorario(cfg, quarta("14:00")).aberta).toBe(false);
  });

  it("config quebrada => ABERTA (fail-safe do n8n)", () => {
    expect(calcHorario(null).aberta).toBe(true);
    expect(calcHorario("{lixo").aberta).toBe(true);
    expect(calcHorario(null).ok).toBe(false);
  });

  it("aceita a config como string JSON, que é como ela vem do banco", () => {
    expect(calcHorario(JSON.stringify(CFG), quarta("14:00")).aberta).toBe(true);
  });

  it("override separa `aberta` de `aberta_natural` e marca forcado", () => {
    const cfg = { ...CFG, override: { ativo: true, aberto: true, ate: null } };
    const h = calcHorario(cfg, quarta("22:00"));
    expect(h.aberta).toBe(true);
    expect(h.aberta_natural).toBe(false);
    expect(h.forcado).toBe(true);
  });

  it("override vencido não vale mais", () => {
    const cfg = {
      ...CFG,
      override: { ativo: true, aberto: true, ate: "2026-08-05T21:00:00.000-03:00" },
    };
    expect(calcHorario(cfg, quarta("22:00")).aberta).toBe(false);
    expect(calcHorario(cfg, quarta("20:30")).aberta).toBe(true);
  });

  it("kill-switch desligado: fechada, mas sem agendar", () => {
    const cfg = { ...CFG, agendamento_ativo: false };
    const h = calcHorario(cfg, quarta("22:00"));
    expect(h.aberta).toBe(false);
    expect(h.fechada).toBe(false);
  });
});

describe("proximaTransicao", () => {
  it("aberta agora => fim da faixa de hoje", () => {
    expect(proximaTransicao(CFG, quarta("14:00"))).toBe(
      new Date("2026-08-05T20:00:00.000-03:00").toISOString(),
    );
  });

  it("fechada de noite => abertura de amanhã", () => {
    expect(proximaTransicao(CFG, quarta("22:00"))).toBe(
      new Date("2026-08-06T08:00:00.000-03:00").toISOString(),
    );
  });

  it("fechada de madrugada => abertura do mesmo dia", () => {
    expect(proximaTransicao(CFG, quarta("03:00"))).toBe(
      new Date("2026-08-05T08:00:00.000-03:00").toISOString(),
    );
  });

  it("sábado à tarde => pula o domingo e cai na segunda", () => {
    const sabado = Date.parse("2026-08-08T15:00:00.000-03:00");
    expect(proximaTransicao(CFG, sabado)).toBe(
      new Date("2026-08-10T08:00:00.000-03:00").toISOString(),
    );
  });
});

describe("proximoOverride", () => {
  it("abrir fora do horário liga o override até a próxima abertura", () => {
    const novo = proximoOverride(CFG, true, quarta("22:00"))!;
    expect(novo.override).toEqual({
      ativo: true,
      aberto: true,
      ate: new Date("2026-08-06T08:00:00.000-03:00").toISOString(),
    });
    // O plantão vale a madrugada inteira — é para isso que o balcão abriu.
    expect(calcHorario(novo, quarta("23:00")).aberta).toBe(true);
    expect(calcHorario(novo, Date.parse("2026-08-06T07:00:00.000-03:00")).aberta).toBe(true);
    // Às 08:00 o override vence e a tabela reassume — mesma resposta, outro motivo.
    const naAbertura = calcHorario(novo, Date.parse("2026-08-06T09:00:00.000-03:00"));
    expect(naAbertura.aberta).toBe(true);
    expect(naAbertura.forcado).toBe(false);
    // E na noite seguinte já fecha sozinha, sem ninguém lembrar de desligar.
    expect(calcHorario(novo, Date.parse("2026-08-06T22:00:00.000-03:00")).aberta).toBe(false);
  });

  it("fechar dentro do horário vale até o fechamento natural", () => {
    const novo = proximoOverride(CFG, false, quarta("14:00"))!;
    expect(novo.override).toEqual({
      ativo: true,
      aberto: false,
      ate: new Date("2026-08-05T20:00:00.000-03:00").toISOString(),
    });
    expect(calcHorario(novo, quarta("15:00")).aberta).toBe(false);
    // Depois do prazo o override some sozinho e a tabela manda (já fechada).
    expect(calcHorario(novo, Date.parse("2026-08-06T09:00:00.000-03:00")).aberta).toBe(true);
  });

  it("clicar para o estado que a tabela já dá desliga o override", () => {
    const forcado = { ...CFG, override: { ativo: true, aberto: false, ate: null } };
    const novo = proximoOverride(forcado, true, quarta("14:00"))!;
    expect(novo.override!.ativo).toBe(false);
  });

  it("null volta ao automático", () => {
    const forcado = { ...CFG, override: { ativo: true, aberto: true, ate: null } };
    expect(proximoOverride(forcado, null, quarta("22:00"))!.override).toEqual({
      ativo: false, aberto: true, ate: null,
    });
  });

  it("a validade é calculada da TABELA, não do override anterior", () => {
    // Já forçada aberta às 22h; clicar em "fechar" não pode herdar o estado forçado.
    const forcado = { ...CFG, override: { ativo: true, aberto: true, ate: null } };
    const novo = proximoOverride(forcado, false, quarta("22:00"))!;
    // Naturalmente já está fechada => não precisa de override nenhum.
    expect(novo.override!.ativo).toBe(false);
  });

  it("preserva o resto da config (semana, exceções, kill-switch)", () => {
    const novo = proximoOverride(CFG, true, quarta("22:00"))!;
    expect(novo.semana).toEqual(CFG.semana);
    expect(novo.agendamento_ativo).toBe(true);
    expect(novo.utc_offset).toBe(-3);
  });
});
