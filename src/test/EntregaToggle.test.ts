import { describe, expect, it } from "vitest";
import { proximoEstadoEntrega, type ConfigEntrega } from "@/components/EntregaToggle";

/**
 * A regra que este teste protege:
 * `ultimo_estado_aberta` pertence ao WF_Agendamento_Liberar (n8n), que o usa para detectar
 * a transição abre/fecha da farmácia e sincronizar a entrega sozinho. Se o painel gravar
 * esse campo, o n8n enxerga uma transição falsa no tick seguinte (≤5 min) e desfaz o clique
 * do balcão — o motoboy sai, o balcão desliga a entrega, e cinco minutos depois ela volta
 * sozinha sem ninguém entender por quê.
 */

const base: ConfigEntrega = {
  ativo: true,
  alterado_em: "2026-08-04T12:00:00.000Z",
  alterado_por: "sistema",
  ultimo_estado_aberta: true,
};

describe("proximoEstadoEntrega", () => {
  it("desliga a entrega e credita ao balcão", () => {
    const r = proximoEstadoEntrega(base, new Date("2026-08-04T18:30:00.000Z"));
    expect(r.ativo).toBe(false);
    expect(r.alterado_por).toBe("balcao");
    expect(r.alterado_em).toBe("2026-08-04T18:30:00.000Z");
  });

  it("religa a entrega quando estava desligada", () => {
    const r = proximoEstadoEntrega({ ...base, ativo: false });
    expect(r.ativo).toBe(true);
  });

  it("PRESERVA ultimo_estado_aberta=true (farmácia aberta)", () => {
    const r = proximoEstadoEntrega(base);
    expect(r.ultimo_estado_aberta).toBe(true);
  });

  it("PRESERVA ultimo_estado_aberta=false (farmácia fechada)", () => {
    const r = proximoEstadoEntrega({ ...base, ativo: false, ultimo_estado_aberta: false });
    expect(r.ultimo_estado_aberta).toBe(false);
  });

  it("não inventa ultimo_estado_aberta quando o campo não existe", () => {
    const semCampo: ConfigEntrega = { ativo: true, alterado_em: null, alterado_por: null };
    expect("ultimo_estado_aberta" in proximoEstadoEntrega(semCampo)).toBe(false);
  });

  it("alternar duas vezes volta ao estado original, sem perder o campo do n8n", () => {
    const ida = proximoEstadoEntrega(base);
    const volta = proximoEstadoEntrega(ida);
    expect(volta.ativo).toBe(base.ativo);
    expect(volta.ultimo_estado_aberta).toBe(true);
  });
});
