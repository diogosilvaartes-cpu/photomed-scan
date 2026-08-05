import React from "react";

/**
 * Quatro quadradinhos de PIN. Vivia dentro de Entregadores.tsx; saiu de lá porque
 * agora o cadastro de balcão usa o mesmo componente.
 */
export default function PinInput({ pin, setPin, pinRefs }: {
  pin: string[];
  setPin: (p: string[]) => void;
  pinRefs: React.RefObject<HTMLInputElement>[];
}) {
  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...pin]; next[index] = digit; setPin(next);
    if (digit && index < 3) pinRefs[index + 1].current?.focus();
  }
  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !pin[index] && index > 0) pinRefs[index - 1].current?.focus();
  }
  return (
    <div className="flex gap-3 justify-center">
      {pin.map((digit, i) => (
        <input key={i} ref={pinRefs[i]} type="number" inputMode="numeric" min={0} max={9}
          value={digit} onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      ))}
    </div>
  );
}
