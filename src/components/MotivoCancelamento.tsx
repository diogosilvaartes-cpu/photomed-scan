import { cn } from "@/lib/utils";
import { MOTIVOS_CANCELAMENTO } from "@/lib/pedido";

/** Chips de motivo + texto livre — usado nos 3 lugares onde dá pra cancelar um pedido. */
export default function MotivoCancelamento({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {MOTIVOS_CANCELAMENTO.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              value === m
                ? "border-destructive bg-destructive text-destructive-foreground"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ou escreva o motivo"
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
      />
    </div>
  );
}
