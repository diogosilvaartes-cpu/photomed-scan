import { describe, expect, it } from "vitest";
import { calcularTaxa, FRETE_PADRAO, type FreteConfig } from "@/lib/frete";

/**
 * A regra que este teste protege:
 * é a taxa que a farmácia cobra de verdade. O mesmo cálculo existe no n8n (nó `Calcular_Frete`
 * do Ana_Agente), e as duas pontas precisam bater — senão o pedido do WhatsApp e o pedido do
 * balcão cobram valores diferentes pela mesma entrega.
 *
 * Os números vêm de `configuracoes.frete_entrega`: R$ 2,00 até 2 km, +R$ 1,00 por km
 * INICIADO acima disso (ceil, não floor), e acima de 15 km não entrega.
 */

const cfg: FreteConfig = FRETE_PADRAO;

describe("calcularTaxa", () => {
  it("cobra a taxa base dentro do raio base", () => {
    expect(calcularTaxa(0.5, cfg).taxa).toBe(2);
    expect(calcularTaxa(2, cfg).taxa).toBe(2);
  });

  it("arredonda o km extra PARA CIMA — 2,1 km já custa 1 km extra", () => {
    expect(calcularTaxa(2.1, cfg).taxa).toBe(3);
    expect(calcularTaxa(3, cfg).taxa).toBe(3);
    expect(calcularTaxa(3.01, cfg).taxa).toBe(4);
  });

  it("bate com o exemplo de referência: 4,5 km = R$ 5,00", () => {
    expect(calcularTaxa(4.5, cfg).taxa).toBe(5);
  });

  it("entrega no limite exato de 15 km", () => {
    const r = calcularTaxa(15, cfg);
    expect(r.foraDeArea).toBe(false);
    expect(r.taxa).toBe(15);
  });

  it("RECUSA acima do limite — sem cálculo, sem exceção", () => {
    expect(calcularTaxa(15.1, cfg).foraDeArea).toBe(true);
    expect(calcularTaxa(40, cfg).foraDeArea).toBe(true);
  });

  it("sem distância informada, assume a taxa base em vez de zerar o frete", () => {
    expect(calcularTaxa(null, cfg).taxa).toBe(2);
    expect(calcularTaxa(0, cfg).taxa).toBe(2);
    expect(calcularTaxa(Number.NaN, cfg).taxa).toBe(2);
  });

  it("obedece a config, não os números fixos do código", () => {
    const outra: FreteConfig = {
      ...cfg, raio_base_km: 3, taxa_base: 5, taxa_por_km_extra: 2, limite_km: 10,
    };
    expect(calcularTaxa(3, outra).taxa).toBe(5);
    expect(calcularTaxa(5, outra).taxa).toBe(9);
    expect(calcularTaxa(11, outra).foraDeArea).toBe(true);
  });
});
