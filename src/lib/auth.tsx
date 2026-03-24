import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { externalSupabase } from "@/integrations/supabase/external-client";

export type UserRole = "admin" | "entregador" | null;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: UserRole;
  entregadorId: string | null;
  entregadorNome: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  entregadorId: null,
  entregadorNome: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [entregadorId, setEntregadorId] = useState<string | null>(null);
  const [entregadorNome, setEntregadorNome] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function resolveRole(userId: string) {
    const { data } = await externalSupabase
      .from("entregadores")
      .select("id, nome")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      setRole("entregador");
      setEntregadorId(data.id);
      setEntregadorNome(data.nome);
    } else {
      setRole("admin");
      setEntregadorId(null);
      setEntregadorNome(null);
    }
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
    <AuthContext.Provider value={{ session, user, role, entregadorId, entregadorNome, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
