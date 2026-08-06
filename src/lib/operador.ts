import { useAuth } from "@/lib/auth";

/**
 * Quem está operando o balcão agora — para carimbar no pedido.
 *
 * `pedidos.operador_id` / `operador_nome` guardam a ÚLTIMA pessoa que mexeu no
 * pedido pelo painel (criou, despachou, cancelou, confirmou a entrega). Pedido
 * que a Maria fechou sozinha fica com os dois NULL, e é assim que a ficha sabe
 * distinguir "veio do WhatsApp" de "alguém do balcão fez".
 *
 * O NOME vai junto do id de propósito: o painel não faz join com `auth.users`, e
 * um pedido de três meses atrás precisa continuar legível mesmo se a conta da
 * pessoa for removida da equipe.
 */
export function useOperador() {
  const { user, nomeExibicao, perfil } = useAuth();

  return {
    operador_id: user?.id ?? null,
    // Mesmo fallback que a sidebar usa, para o nome não mudar de tela para tela:
    // quem está cadastrado na equipe aparece pelo nome; o admin raiz não tem cadastro.
    operador_nome: nomeExibicao ?? (perfil === "balcao" ? "Balcão" : "Admin"),
  };
}
