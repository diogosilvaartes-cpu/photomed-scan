import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bike, Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase, pinToPassword } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { emailDoMembro, iniciais, type Funcao, type MembroEquipe } from "@/lib/equipe";

type CardEquipe = MembroEquipe & { funcao: Funcao };

/**
 * Quem está ativo na equipe, para os cards. Só nome e telefone — o telefone é o
 * que vira o e-mail do login, e ninguém do balcão decorou
 * `5522988177719@farmaciavital.internal`.
 *
 * A senha continua sendo digitada: o card só escolhe QUEM está entrando.
 */
async function fetchEquipeLogin(): Promise<CardEquipe[]> {
  const [entregadores, atendentes] = await Promise.all([
    externalSupabase.from("entregadores").select("id, nome, telefone, ativo, user_id").eq("ativo", true),
    externalSupabase.from("atendentes").select("id, nome, telefone, ativo, user_id").eq("ativo", true),
  ]);

  const comFuncao = (rows: unknown, funcao: Funcao): CardEquipe[] =>
    ((rows ?? []) as MembroEquipe[])
      // Sem `user_id` a pessoa está cadastrada mas não tem login criado — o card
      // só levaria a um "senha incorreta" que ninguém consegue explicar.
      .filter((m) => !!m.user_id)
      .map((m) => ({ ...m, funcao }));

  return [
    ...comFuncao(atendentes.data, "balcao"),
    ...comFuncao(entregadores.data, "entregador"),
  ].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, role } = useAuth();

  // O `ProtectedRoute` guarda em `state.from` a página que a pessoa tentou abrir.
  // Sem respeitar isso, quem chega por link do WhatsApp (`/pedido/04ago1157`) loga
  // e cai na home, perdendo o pedido que queria ver.
  const destino = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const { data: equipe } = useQuery({
    queryKey: ["equipe-login"],
    queryFn: fetchEquipeLogin,
    // Falhar aqui não pode travar o login: sem os cards, o formulário resolve.
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (session && role) {
      navigate(destino ?? (role === "entregador" ? "/entregas" : "/"), { replace: true });
    }
  }, [session, role, navigate, destino]);

  function escolher(m: CardEquipe) {
    setSelecionado(m.id);
    setEmail(emailDoMembro(m.telefone));
    setPassword("");
    senhaRef.current?.focus();
  }

  /**
   * O PIN de 4 dígitos definido na aba Equipe é gravado como `fv1234` — o Supabase
   * exige 6 caracteres. Quem digita só o PIN receberia "senha incorreta" sem ter
   * errado nada, então a segunda tentativa aplica o mesmo prefixo antes de desistir.
   */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    let { error } = await externalSupabase.auth.signInWithPassword({ email, password });
    if (error && /^\d{4}$/.test(password)) {
      ({ error } = await externalSupabase.auth.signInWithPassword({
        email,
        password: pinToPassword(password),
      }));
    }

    setLoading(false);
    if (error) {
      toast({
        title: "Acesso negado",
        description: "Email ou senha incorretos.",
        variant: "destructive",
      });
    }
  }

  const cards = equipe ?? [];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <BrandMark className="w-16 h-16 mb-4" />
          <h1 className="font-display text-3xl font-extrabold text-foreground">Farmácia Vital</h1>
          <p className="text-sm text-muted-foreground mt-1">Painel Operacional</p>
        </div>

        {cards.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Quem está entrando?</p>
            <div className="grid grid-cols-2 gap-2">
              {cards.map((m) => {
                const ativo = selecionado === m.id;
                const Icone = m.funcao === "entregador" ? Bike : Store;
                return (
                  <button
                    key={`${m.funcao}-${m.id}`}
                    type="button"
                    onClick={() => escolher(m)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
                      ativo
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    <span className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                      ativo ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                    )}>
                      {iniciais(m.nome)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground truncate">{m.nome}</span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Icone className="w-3 h-3 shrink-0" />
                        {m.funcao === "entregador" ? "Entregador" : "Balcão"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSelecionado(null); }}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{selecionado ? "PIN ou senha" : "Senha"}</Label>
              <Input
                id="password"
                ref={senhaRef}
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
