import { cn } from "@/lib/utils";

/**
 * Código do pedido / do agendamento em destaque.
 *
 * É por ele que balcão, entregador e cliente conversam sobre um pedido — no
 * grupo do Balcão, no WhatsApp do motoboy e no link da ficha. Estava em
 * `text-[11px] text-muted-foreground` no rodapé do nome, quase invisível.
 * Agora é o segundo elemento mais forte do card, depois do nome do cliente.
 *
 * `font-mono` de propósito: `04ago1157` é lido caractere a caractere, e a
 * largura fixa evita confundir o `1` com o `l`.
 */

const TAMANHO = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
} as const;

export default function CodigoPedido({
  codigo,
  tamanho = "md",
  className,
}: {
  codigo: string | null | undefined;
  tamanho?: keyof typeof TAMANHO;
  className?: string;
}) {
  if (!codigo) return null;
  return (
    <span
      className={cn(
        "font-mono font-extrabold tracking-tight text-foreground",
        TAMANHO[tamanho],
        className,
      )}
    >
      {codigo}
    </span>
  );
}
