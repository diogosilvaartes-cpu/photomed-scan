/**
 * Tipos e helpers do pedido, compartilhados entre a fila (`Pedidos.tsx`)
 * e a ficha completa (`FichaPedido.tsx`).
 *
 * `fichaTexto()` é a fonte única do resumo que vai para o entregador no
 * WhatsApp — o mesmo texto que o botão "Copiar ficha" coloca na área de
 * transferência. Ao mudar o formato, mudar aqui.
 */

export interface Item {
  item: string;
  quantidade: number;
  observacao?: string | null;
}

export interface ItemPagamento {
  forma: string;
  valor: number;
}

export interface Despacho {
  id: string;
  entregador_id: string | null;
  pagamento_recebido: ItemPagamento[] | null;
  enviado_em: string | null;
  saiu_em: string | null;
  chegou_em: string | null;
  entregue_em: string | null;
  localizacao: string | null;
  status_entrega: string;
  observacao: string | null;
  fotos: string[] | null;
  rota_link: string | null;
}

export interface Pedido {
  id: string;
  /** Código legível gerado por trigger no banco: dia + mês + hora local (`04ago1157`). */
  codigo: string | null;
  cliente_id: string | null;
  status: string | null;
  resumo: string | null;
  tipo_fulfillment: string | null;
  endereco: string | null;
  /**
   * Aponta para a linha de `enderecos` usada neste pedido. `pedidos.endereco`
   * continua sendo o texto que o cliente ditou (é o que o entregador lê), mas o
   * casamento por texto perdia a coordenada quando a grafia variava: é por isso
   * que a tabela `enderecos` estava com lat/lng NULL em todas as linhas.
   */
  endereco_id: string | null;
  pagamento: string | null;
  valor_total: number | null;
  pix_link: string | null;
  obs_entrega: string | null;
  /** Preenchido ao cancelar pelo painel — o balcão precisa saber por que caiu. */
  motivo_cancelamento: string | null;
  /**
   * Pagamento confirmado pelo BALCÃO ao fechar o pedido pelo Kanban/"Na rua",
   * quando o entregador ainda não tinha registrado nada em `despacho_entrega`.
   * A ficha mostra este campo como reserva do de `despacho_entrega`.
   */
  pagamento_recebido: ItemPagamento[] | null;
  /** Última pessoa do balcão que mexeu no pedido. NULL = foi a Maria, sozinha. */
  operador_id: string | null;
  operador_nome: string | null;
  pessoa_recebimento: string | null;
  created_at: string | null;
  updated_at: string | null;
  clientes: {
    nome: string | null;
    telefone: string | null;
    foto_url?: string | null;
    /** Nota que o entregador deixou sobre o cliente — vai no bilhete de entrega. */
    anotacoes_entregador?: string | null;
  } | null;
  itens_pedido: Item[];
  despacho_entrega: Despacho[];
}

export interface EntregadorFull {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
  user_id: string | null;
}

/**
 * Motivos padrão de cancelamento — os mesmos nos 3 lugares onde dá pra
 * cancelar um pedido (ficha, card do Kanban, tela do entregador). Fonte
 * única para não divergir como já divergiu outras regras neste projeto.
 */
export const MOTIVOS_CANCELAMENTO = [
  "Cliente desistiu",
  "Sem estoque",
  "Endereço errado",
  "Cliente não atende",
  "Pedido duplicado",
];

/** Select do PostgREST com tudo que a fila E a ficha precisam. */
export const PEDIDO_SELECT =
  "*, clientes(nome, telefone, foto_url, anotacoes_entregador), itens_pedido(item, quantidade, observacao), " +
  "despacho_entrega(id, entregador_id, pagamento_recebido, enviado_em, saiu_em, chegou_em, " +
  "entregue_em, localizacao, status_entrega, observacao, fotos, rota_link)";

export function formatPhone(tel: string | null | undefined) {
  if (!tel) return null;
  return tel.replace(/\D/g, "").replace(/^55/, "");
}

/**
 * Foto de perfil do WhatsApp pelo proxy `/api/whatsapp-photo`.
 *
 * O link que a Z-API devolve (`pps.whatsapp.net/...`) expira em poucos dias,
 * então a URL gravada em `clientes.foto_url` envelhece. O proxy resolve o link
 * fresco a cada requisição — e mantém o Client-Token fora do bundle.
 */
export function fotoWhatsApp(telefone: string | null | undefined) {
  const digits = (telefone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `/api/whatsapp-photo?phone=${digits}`;
}

export function formatCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function isCoords(str: string) {
  return /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(str.trim());
}

export function mapsLink(endereco: string) {
  return isCoords(endereco)
    ? `https://maps.google.com/?q=${endereco.replace(/\s/g, "")}`
    : `https://maps.google.com/?q=${encodeURIComponent(endereco)}`;
}

/**
 * Nº do pedido — mesmo valor que o n8n usa no grupo Balcão e na mensagem do entregador.
 *
 * A fonte é `pedidos.codigo` (trigger `gerar_codigo_pedido` no banco): dia + mês abreviado
 * + hora local, ex. `04ago1157`. O uuid curto é fallback só para pedidos anteriores à
 * migração, que foram todos backfillados — na prática não deve aparecer.
 */
export function pedidoNumero(p: Pick<Pedido, "id" | "codigo">) {
  return p.codigo ?? p.id.substring(0, 8).toUpperCase();
}

/** Itens sem o lixo que às vezes o agente grava ("[object Object]", item vazio). */
export function itensValidos(p: Pedido): Item[] {
  return p.itens_pedido?.filter((i) => i.item && i.item !== "[object Object]") ?? [];
}

/**
 * Ficha em texto, no mesmo formato que o entregador recebe no WhatsApp
 * (nó `Desp_Montar_Msg` do workflow Despacho_Motoboy).
 *
 * O bilhete é montado dos dados crus do pedido — nunca de `resumo`, que guarda
 * a fala da Maria **para o cliente** ("seu pedido está a caminho", endereço
 * repetido) e não serve para quem vai entregar.
 *
 * Duas linhas que só o WhatsApp tem: a referência do endereço (exige join com
 * `enderecos`) e a nota interna, quando o cliente tem uma.
 */
export function fichaTexto(p: Pedido, entregadorNome?: string | null): string {
  const tel = (p.clientes?.telefone ?? "").replace(/\D/g, "");
  const itens = itensValidos(p);
  const retirada = p.tipo_fulfillment === "retirada";
  const linhas: string[] = [];

  linhas.push(`🛵 *NOVA ENTREGA* — ${pedidoNumero(p)}`);
  linhas.push("");
  linhas.push(`👤 *${p.clientes?.nome ?? "Cliente"}*`);
  if (tel) linhas.push(`📱 wa.me/${tel}`);
  linhas.push("");

  if (retirada) {
    linhas.push("🏪 *Retirada na loja*");
  } else {
    linhas.push(`📍 *${p.endereco ?? "endereço não informado"}*`);
    if (p.endereco) linhas.push(`🗺️ ${mapsLink(p.endereco)}`);
  }

  if (p.obs_entrega) linhas.push(`📝 *Obs. do cliente:* ${p.obs_entrega}`);
  if (p.pessoa_recebimento) linhas.push(`🙋 *Entregar a:* ${p.pessoa_recebimento}`);
  if (p.clientes?.anotacoes_entregador) {
    linhas.push(`🗒️ *Nota interna:* ${p.clientes.anotacoes_entregador.replace(/\s*\n\s*/g, " / ").trim()}`);
  }

  linhas.push("");
  linhas.push("📦 *Levar:*");
  if (itens.length) {
    itens.forEach((i) => {
      linhas.push(`• ${i.quantidade}x ${i.item}${i.observacao ? ` (${i.observacao})` : ""}`);
    });
  } else {
    linhas.push("• (conferir com o balcão)");
  }

  linhas.push("");
  const valor = p.valor_total != null ? formatCurrency(p.valor_total) : "—";
  linhas.push(`💰 *Total: ${valor}*  •  💳 ${p.pagamento ?? "a combinar"}`);
  linhas.push("");
  // Antes ia o link da ficha de UM pedido (`/pedido/<codigo>`). O entregador
  // costuma sair com mais de uma entrega, e a ficha isolada não mostra as outras
  // nem os botões de "saiu / cheguei / entreguei". `/entregas` é a tela de
  // trabalho dele: todas as entregas do dia, com as ações. Mudar aqui exige
  // mudar também no `Desp_Montar_Msg` do workflow Despacho_Motoboy.
  linhas.push(`🛵 Suas entregas: ${window.location.origin}/entregas`);
  if (p.pix_link) linhas.push(`🔗 PIX: ${p.pix_link}`);
  if (entregadorNome) linhas.push(`🛵 Entregador: ${entregadorNome}`);

  return linhas.join("\n");
}
