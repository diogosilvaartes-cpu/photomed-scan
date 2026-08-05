/**
 * Equipe da farmácia: quem tem login no painel.
 *
 * São duas tabelas de propósito, não uma com coluna `funcao`:
 *  · `entregadores` — o n8n lê esta tabela para escolher motoboy (Buscar_Entregador,
 *    Desp_*). Quem está aqui pode receber uma entrega.
 *  · `atendentes`   — balcão. Opera o painel, nunca aparece como opção de entrega.
 *
 * Uma tabela só obrigaria o n8n a filtrar a função em todo lugar; esquecer um
 * filtro despacharia um pedido para quem está atrás do balcão.
 */

export type Funcao = "entregador" | "balcao";

export type MembroEquipe = {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
  user_id: string | null;
};

/** Nome da tabela de cada função — o painel escreve nas duas pelo mesmo componente. */
export const TABELA_DA_FUNCAO: Record<Funcao, "entregadores" | "atendentes"> = {
  entregador: "entregadores",
  balcao: "atendentes",
};

export const ROTULO_FUNCAO: Record<Funcao, string> = {
  entregador: "Entregador",
  balcao: "Balcão",
};

/**
 * O login de toda a equipe é derivado do telefone — ninguém tem e-mail de verdade.
 * Estava escrito à mão em dois lugares; se as duas formas divergirem, a pessoa
 * cadastrada num lugar não consegue entrar pelo outro.
 */
export function emailDoMembro(telefone: string): string {
  return `${telefone.replace(/\D/g, "")}@farmaciavital.internal`;
}

/** Iniciais para o avatar: no máximo duas letras, sempre maiúsculas. */
export function iniciais(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** Telefone brasileiro em formato legível; devolve a entrada crua se não reconhecer. */
export function telefoneCurto(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  const semPais = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (semPais.length === 11) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  if (semPais.length === 10) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`;
  return telefone;
}
