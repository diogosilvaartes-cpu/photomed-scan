import { MapPin } from "lucide-react";
import { isCoords, mapsLink } from "@/lib/pedido";
import { cn } from "@/lib/utils";

/**
 * Tailwind não gera classe montada em runtime (`line-clamp-${n}` não existe no
 * CSS final). O mapa fixo é o que faz o clamp realmente valer.
 */
const CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
};

/**
 * Endereço clicável — abre o Google Maps.
 *
 * Regra do painel: **onde aparece endereço, aparece o caminho até ele**. Antes
 * metade das telas mostrava o endereço como texto morto (modal de despacho, card
 * do entregador, agendados, aba Entregadores) e quem precisava chegar lá tinha
 * que copiar e colar no Maps.
 *
 * O `stopPropagation` é obrigatório e vem de fábrica: quase todo lugar que mostra
 * endereço está dentro de um card clicável que abre a ficha do pedido. Sem ele,
 * tocar no endereço abria a ficha em vez do Maps.
 */
export default function EnderecoLink({
  endereco,
  className,
  icone = true,
  linhas = 2,
}: {
  endereco: string | null | undefined;
  className?: string;
  /** Some com o pin quando o layout já tem um ícone próprio na linha. */
  icone?: boolean;
  /** 0 = sem clamp (deixa quebrar à vontade). */
  linhas?: number;
}) {
  const end = endereco?.trim();
  if (!end) return null;

  return (
    <a
      href={mapsLink(end)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Abrir no Google Maps: ${end}`}
      className={cn(
        "inline-flex items-start gap-1.5 text-sm text-status-ink-novo hover:underline",
        className,
      )}
    >
      {icone && <MapPin className="w-4 h-4 mt-0.5 shrink-0" />}
      <span className={CLAMP[linhas]}>
        {isCoords(end) ? "Ver no Maps" : end}
      </span>
    </a>
  );
}
