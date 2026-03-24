import { createClient } from '@supabase/supabase-js';

const EXTERNAL_SUPABASE_URL = "https://pkyhdtaevvyziitpbkib.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreWhkdGFldnZ5emlpdHBia2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2Njk2MDksImV4cCI6MjA4OTI0NTYwOX0.yPbpoWjPuz6fTAm-JpjymWzdXA8b6TbBelP1i4s1OJg";

export const externalSupabase = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Converte PIN de 4 dígitos para senha válida no Supabase (mín. 6 chars)
export const pinToPassword = (pin: string) => `fv${pin}`;

// Cria um cliente isolado (sem persistência de sessão) para criar usuários Auth
// sem afetar a sessão do admin logado.
export function createTempAuthClient() {
  return createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
