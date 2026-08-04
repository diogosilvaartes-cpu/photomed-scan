import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, role } = useAuth();

  // O `ProtectedRoute` guarda em `state.from` a página que a pessoa tentou abrir.
  // Sem respeitar isso, quem chega por link do WhatsApp (`/pedido/04ago1157`) loga
  // e cai na home, perdendo o pedido que queria ver.
  const destino = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  useEffect(() => {
    if (session && role) {
      navigate(destino ?? (role === "entregador" ? "/entregas" : "/"), { replace: true });
    }
  }, [session, role, navigate, destino]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await externalSupabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({
        title: "Acesso negado",
        description: "Email ou senha incorretos.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <BrandMark className="w-16 h-16 mb-4" />
          <h1 className="font-display text-3xl font-extrabold text-foreground">Farmácia Vital</h1>
          <p className="text-sm text-muted-foreground mt-1">Painel Operacional</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Entrando...</>
              ) : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
