import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { externalSupabase } from "@/integrations/supabase/external-client";

/**
 * `role` decide PERMISSÃO e só tem dois valores. O atendente de balcão entra
 * como "admin" de propósito: ele opera a mesma tela do dono, e criar um terceiro
 * valor faria toda comparação `role === "admin"` espalhada pelo painel
 * (ProtectedRoute, readOnly de Pedidos, adminOnly do menu) passar a excluí-lo em
 * silêncio.
 *
 * Quem a pessoa é fica em `perfil`, que serve só para exibição.
 */
export type UserRole = "admin" | "entregador" | null;
export type UserPerfil = "admin" | "balcao" | "entregador" | null;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: UserRole;
  perfil: UserPerfil;
  /** Nome cadastrado na equipe (entregador ou balcão). NULL para o admin raiz. */
  nomeExibicao: string | null;
  entregadorId: string | null;
  entregadorNome: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  perfil: null,
  nomeExibicao: null,
  entregadorId: null,
  entregadorNome: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [perfil, setPerfil] = useState<UserPerfil>(null);
  const [nomeExibicao, setNomeExibicao] = useState<string | null>(null);
  const [entregadorId, setEntregadorId] = useState<string | null>(null);
  const [entregadorNome, setEntregadorNome] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Ordem importa: entregador primeiro. Quem está nas duas tabelas trabalha na
   * rua, e mandá-lo para o painel do balcão o deixaria sem a tela de entregas.
   * Não achou em nenhuma = admin raiz (o login que não tem cadastro de equipe).
   */
  async function resolveRole(userId: string) {
    const { data: entregador } = await externalSupabase
      .from("entregadores")
      .select("id, nome")
      .eq("user_id", userId)
      .maybeSingle();

    if (entregador) {
      setRole("entregador");
      setPerfil("entregador");
      setNomeExibicao(entregador.nome);
      setEntregadorId(entregador.id);
      setEntregadorNome(entregador.nome);
      return;
    }

    const { data: atendente } = await externalSupabase
      .from("atendentes")
      .select("id, nome")
      .eq("user_id", userId)
      .maybeSingle();

    setRole("admin");
    setPerfil(atendente ? "balcao" : "admin");
    setNomeExibicao(atendente?.nome ?? null);
    setEntregadorId(null);
    setEntregadorNome(null);
  }

  useEffect(() => {
    externalSupabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        resolveRole(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = externalSupabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        resolveRole(session.user.id);
      } else {
        setRole(null);
        setPerfil(null);
        setNomeExibicao(null);
        setEntregadorId(null);
        setEntregadorNome(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await externalSupabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user, role, perfil, nomeExibicao, entregadorId, entregadorNome, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
