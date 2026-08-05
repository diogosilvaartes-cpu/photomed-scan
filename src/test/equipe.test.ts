import { describe, expect, it } from "vitest";
import { emailDoMembro, iniciais, telefoneCurto, TABELA_DA_FUNCAO } from "@/lib/equipe";

/**
 * O login de toda a equipe é derivado do telefone — ninguém tem e-mail de
 * verdade. A regra estava escrita à mão em dois lugares (cadastro e redefinição
 * de PIN); divergindo, a pessoa é cadastrada com um e-mail e o card da tela de
 * login tenta entrar com outro, e o erro que aparece é só "senha incorreta".
 */
describe("emailDoMembro", () => {
  it("usa só os dígitos do telefone", () => {
    expect(emailDoMembro("+55 (22) 98811-8535")).toBe("5522988118535@farmaciavital.internal");
  });

  it("dá o mesmo e-mail para o mesmo número escrito de formas diferentes", () => {
    expect(emailDoMembro("5522988118535")).toBe(emailDoMembro("55 22 98811 8535"));
  });
});

describe("iniciais", () => {
  it("pega no máximo duas letras", () => {
    expect(iniciais("Diogo da Silva Artes")).toBe("DD");
  });
  it("aguenta nome de uma palavra só", () => {
    expect(iniciais("samuel")).toBe("S");
  });
});

describe("telefoneCurto", () => {
  it("formata celular com DDD, tirando o 55", () => {
    expect(telefoneCurto("5522988118535")).toBe("(22) 98811-8535");
  });
  it("devolve como veio quando não reconhece o formato", () => {
    expect(telefoneCurto("123")).toBe("123");
  });
});

/**
 * Balcão e entregador em tabelas separadas é o que impede o n8n de despachar uma
 * entrega para quem está atrás do balcão — ele escolhe motoboy lendo
 * `entregadores`. Se algum dia isto virar uma tabela só, o filtro tem que entrar
 * no n8n junto.
 */
describe("TABELA_DA_FUNCAO", () => {
  it("mantém balcão fora da tabela que o n8n usa para despachar", () => {
    expect(TABELA_DA_FUNCAO.entregador).toBe("entregadores");
    expect(TABELA_DA_FUNCAO.balcao).toBe("atendentes");
  });
});
