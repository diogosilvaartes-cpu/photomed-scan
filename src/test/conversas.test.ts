import { describe, expect, it } from "vitest";
import {
  parseHistorico,
  statusPausa,
  formatarRestante,
  ordenarConversas,
  agruparPorTelefone,
  type ConversaRow,
} from "@/pages/Conversas";

/**
 * A regra que este teste protege:
 * a tela precisa dizer a VERDADE sobre quem está atendendo. O guard do n8n
 * (`IF_Ana_Pausada`, no Ana_Agente — nome de nó, a atendente virou Maria) só
 * segura a Maria com as duas condições — `estado = aguardando_humano` E
 * `pausada_ate` no futuro. Se o painel considerar só o estado, ele mostra "com o
 * balcão" para uma conversa que a Maria já reassumiu, e o atendente fica
 * esperando um cliente que já está sendo respondido pelo robô.
 */

const AGORA = new Date("2026-08-05T12:00:00Z");
const daqui = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();

describe("statusPausa", () => {
  it("segura a Maria com estado de handoff e prazo no futuro", () => {
    const p = statusPausa("aguardando_humano", daqui(90), AGORA);
    expect(p.pausada).toBe(true);
    expect(p.minutosRestantes).toBe(90);
  });

  it("libera a Maria quando o prazo venceu, mesmo com o estado ainda gravado", () => {
    expect(statusPausa("aguardando_humano", daqui(-1), AGORA).pausada).toBe(false);
  });

  it("libera a Maria quando o estado é de handoff mas ninguém marcou prazo", () => {
    // É o caso das conversas antigas, anteriores à coluna pausada_ate.
    expect(statusPausa("aguardando_humano", null, AGORA).pausada).toBe(false);
  });

  it("não segura a Maria em estado normal, mesmo com prazo no futuro", () => {
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

/**
 * O `Insert_Conversa_HTTP` (Ana_Agente) abre uma conversa nova sempre que a
 * anterior está em `pedido_criado` — um número só já acumulou 7 linhas no banco.
 * Sem agrupar, o balcão vê o mesmo cliente sete vezes e pode devolver para a
 * Maria uma conversa velha enquanto a viva continua parada com o balcão.
 */
describe("agruparPorTelefone", () => {
  const comTelefone = (
    id: string,
    telefone: string,
    estado: string,
    pausadaAte: string | null,
    updated: string,
    historico?: string,
  ) =>
    ({
      id,
      cliente_id: `c-${telefone}`,
      estado,
      ultima_mensagem: null,
      resumo_contexto: historico ?? null,
      pausada_ate: pausadaAte,
      updated_at: updated,
      clientes: { nome: "Cliente", telefone, foto_url: null },
    }) as ConversaRow;

  it("junta as conversas do mesmo número numa linha só", () => {
    const grupos = agruparPorTelefone(
      [
        comTelefone("a", "5522988118535", "pedido_criado", null, daqui(-100)),
        comTelefone("b", "5522988118535", "entendendo_pedido", null, daqui(-2)),
        comTelefone("c", "5521999990000", "novo_contato", null, daqui(-5)),
      ],
      AGORA,
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.chave === "5522988118535")!.conversas).toHaveLength(2);
  });

  it("ignora a máscara do telefone ao agrupar", () => {
    const grupos = agruparPorTelefone(
      [
        comTelefone("a", "5522988118535", "novo_contato", null, daqui(-9)),
        comTelefone("b", "+55 (22) 98811-8535", "novo_contato", null, daqui(-1)),
      ],
      AGORA,
    );
    expect(grupos).toHaveLength(1);
  });

  it("a principal é a que está com o balcão, mesmo sendo a mais antiga", () => {
    // Se a principal fosse só "a mais recente", o botão Devolver agiria na
    // conversa errada e a que está travada continuaria travada.
    const grupos = agruparPorTelefone(
      [
        comTelefone("nova", "5522988118535", "pedido_criado", null, daqui(-1)),
        comTelefone("parada", "5522988118535", "aguardando_humano", daqui(60), daqui(-90)),
      ],
      AGORA,
    );
    expect(grupos[0].principal.id).toBe("parada");
  });

  it("sem ninguém segurado, a principal é a de movimento mais recente", () => {
    const grupos = agruparPorTelefone(
      [
        comTelefone("velha", "5522988118535", "pedido_criado", null, daqui(-90)),
        comTelefone("nova", "5522988118535", "entendendo_pedido", null, daqui(-1)),
      ],
      AGORA,
    );
    expect(grupos[0].principal.id).toBe("nova");
  });

  it("consolida o histórico em ordem cronológica e marca onde cada atendimento começa", () => {
    const grupos = agruparPorTelefone(
      [
        comTelefone("nova", "5522988118535", "entendendo_pedido", null, daqui(-1),
          '[{"role":"cliente","content":"quero de novo"}]'),
        comTelefone("velha", "5522988118535", "pedido_criado", null, daqui(-90),
          '[{"role":"cliente","content":"oi"},{"role":"ana","content":"ola"}]'),
      ],
      AGORA,
    );
    const h = grupos[0].historico;
    expect(h.map((t) => t.content)).toEqual(["oi", "ola", "quero de novo"]);
    expect(h.map((t) => t.inicioDeConversa)).toEqual([true, false, true]);
  });

  it("não perde conversa de cliente sem telefone", () => {
    const semTelefone = {
      id: "x", cliente_id: "c1", estado: "novo_contato", ultima_mensagem: null,
      resumo_contexto: null, pausada_ate: null, updated_at: daqui(-3), clientes: null,
    } as ConversaRow;
    const grupos = agruparPorTelefone([semTelefone], AGORA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].chave).toBe("c1");
  });

  it("mantém a fila: quem está com o balcão aparece antes", () => {
    const grupos = agruparPorTelefone(
      [
        comTelefone("a", "5511111111111", "entendendo_pedido", null, daqui(-1)),
        comTelefone("b", "5522222222222", "aguardando_humano", daqui(30), daqui(-120)),
      ],
      AGORA,
    );
    expect(grupos.map((g) => g.chave)).toEqual(["5522222222222", "5511111111111"]);
  });
});
