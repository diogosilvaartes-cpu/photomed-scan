import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase, pinToPassword } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const { toast } = useToast();
  const navigate = useNavigate();
  const { session, role } = useAuth();

  useEffect(() => {
    if (session && role) {
      navigate(role === "entregador" ? "/entregas" : "/", { replace: true });
    }
  }, [session, role, navigate]);

  function handlePinChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    if (digit && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  }

  function handlePinKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinRefs[index - 1].current?.focus();
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const pinStr = pin.join("");
    if (!phone.trim()) {
      toast({ title: "Informe o telefone", variant: "destructive" });
      return;
    }
    if (pinStr.length < 4) {
      toast({ title: "PIN incompleto", description: "Digite os 4 dígitos.", variant: "destructive" });
      return;
    }
    setLoading(true);
    // Remove non-digits for phone numbers; keep as-is for special identifiers like "admin"
    const cleaned = /^\d+$/.test(phone.trim()) ? phone.trim().replace(/\D/g, "") : phone.trim();
    const email = `${cleaned}@farmaciavital.internal`;
    const { error } = await externalSupabase.auth.signInWithPassword({ email, password: pinToPassword(pinStr) });
    setLoading(false);
    if (error) {
      toast({
        title: "Acesso negado",
        description: "Telefone ou PIN incorretos.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary p-3 rounded-2xl mb-3">
            <Package className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Farmácia Vital</h1>
          <p className="text-sm text-muted-foreground mt-1">Painel Operacional</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Ex: 21999999999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                className="input-med"
              />
            </div>

            <div className="space-y-1.5">
              <Label>PIN</Label>
              <div className="flex gap-3 justify-center">
                {pin.map((digit, i) => (
                  <input
                    key={i}
                    ref={pinRefs[i]}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={9}
                    value={digit}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
