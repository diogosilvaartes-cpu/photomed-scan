import { cn } from "@/lib/utils";

/**
 * Símbolo da Farmácia Vital: cruz farmacêutica com uma folha brotando,
 * dentro de um quadrado arredondado. Legível de 24px a 96px.
 *
 * variant="onDark"  — quadrado claro, glifo verde (sidebar)
 * variant="onLight" — quadrado verde, glifo branco (login, fundo claro)
 */
export default function BrandMark({
  className,
  variant = "onLight",
}: {
  className?: string;
  variant?: "onDark" | "onLight";
}) {
  const onDark = variant === "onDark";

  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label="Farmácia Vital"
      className={cn("shrink-0", className)}
    >
      <rect
        width="40"
        height="40"
        rx="11"
        className={onDark ? "fill-white" : "fill-primary"}
      />
      {/* Cruz farmacêutica — deslocada para baixo/esquerda, abrindo espaço à folha */}
      <g className={onDark ? "fill-primary" : "fill-white"}>
        <rect x="14.4" y="12" width="7.2" height="21" rx="2.2" />
        <rect x="7.5" y="19.4" width="21" height="7.2" rx="2.2" />
      </g>
      {/* Folha brotando no canto superior direito, destacada da cruz */}
      <path
        d="M24.6 14.2c0-5.4 4-9.6 9.4-9.6 0 5.4-4 9.6-9.4 9.6Z"
        className={onDark ? "fill-primary" : "fill-white"}
      />
    </svg>
  );
}
