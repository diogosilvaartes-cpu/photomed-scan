import { describe, expect, it } from "vitest";
import {
  parseHistorico,
  statusPausa,
  formatarRestante,
  ordenarConversas,
  type ConversaRow,
} from "@/pages/Conversas";

/**
 * A regra que este teste protege:
 * a tela precisa dizer a VERDADE sobre quem está atendendo. O guard do n8n
 * (`IF_Ana_Pausada`, no Ana_Agente) só segura a Ana com as duas condições —
 * `estado = aguardando_humano` E `pausada_ate` no futuro. Se o painel considerar
 * só o estado, ele mostra "com o balcão" para uma conversa que a Ana já reassumiu,
 * e o atendente fica esperando um cliente que já está sendo respondido pelo robô.
 */

const AGORA = new Date("2026-08-05T12:00:00Z");
const daqui = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();

describe("statusPausa", () => {
  it("segura a Ana com estado de handoff e prazo no futuro", () => {
    const p = statusPausa("aguardando_humano", daqui(90), AGORA);
    expect(p.pausada).toBe(true);
    expect(p.minutosRestantes).toBe(90);
  });

  it("libera a Ana quando o prazo venceu, mesmo com o estado ainda gravado", () => {
    expect(statusPausa("aguardando_humano", daqui(-1), AGORA).pausada).toBe(false);
  });

  it("libera a Ana quando o estado é de handoff mas ninguém marcou prazo", () => {
    // É o caso das conversas antigas, anteriores à coluna pausada_ate.
    expect(statusPausa("aguardando_humano", null, AGORA).pausada).toBe(false);
  });

  it("não segura a Ana em estado normal, mesmo com prazo no futuro", () => {
    expect(statusPausa("entendendo_pedido", daqui(90), AGORA).pausada).toBe(false);
  });

  it("aguenta data inválida sem quebrar a tela", () => {
    expect(statusPausa("aguardando_humano", "nao-e-data", AGORA).pausada).toBe(false);
  });
});

describe("formatarRestante", () => {
  it("mostra minutos abaixo de uma hora", () => {
    expect(formatarRestante(45)).toBe("45 min");
  });
  it("mostra hora cheia sem os minutos", () => {
    expect(formatarRestante(120)).toBe("2h");
  });
  it("mostra hora com minutos preenchidos", () => {
    expect(formatarRestante(95)).toBe("1h35");
  });
});

describe("parseHistorico", () => {
  it("lê o array JSON que o n8n grava em resumo_contexto", () => {
    const raw = '[{"role":"cliente","content":"oi"},{"role":"atendente","content":"aqui e o balcao"}]';
    expect(parseHistorico(raw)).toHaveLength(2);
    expect(parseHistorico(raw)[1].role).toBe("atendente");
  });

  it("devolve vazio em vez de explodir com JSON quebrado", () => {
    expect(parseHistorico("{isso nao e json")).toEqual([]);
    expect(parseHistorico(null)).toEqual([]);
    expect(parseHistorico('{"role":"cliente"}')).toEqual([]);
  });

  it("descarta turno sem conteúdo de texto", () => {
    expect(parseHistorico('[{"role":"cliente"},{"role":"ana","content":"ok"}]')).toHaveLength(1);
  });
});

describe("ordenarConversas", () => {
  const linha = (id: string, estado: string, pausadaAte: string | null, updated: string) =>
    ({
      id, cliente_id: "c", estado, ultima_mensagem: null, resumo_contexto: null,
      pausada_ate: pausadaAte, updated_at: updated, clientes: null,
    }) as ConversaRow;

  it("põe quem está com o balcão no topo, mesmo sendo mais antiga", () => {
    const rows = [
      linha("recente", "entendendo_pedido", null, daqui(-5)),
      linha("parada", "aguardando_humano", daqui(60), daqui(-120)),
    ];
    expect(ordenarConversas(rows, AGORA).map((r) => r.id)).toEqual(["parada", "recente"]);
  });

  it("entre iguais, a mais recente primeiro", () => {
    const rows = [
      linha("velha", "entendendo_pedido", null, daqui(-60)),
      linha("nova", "entendendo_pedido", null, daqui(-1)),
    ];
    expect(ordenarConversas(rows, AGORA).map((r) => r.id)).toEqual(["nova", "velha"]);
  });
});
