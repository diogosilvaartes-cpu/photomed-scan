export const config = { runtime: "edge" };

/**
 * Login da equipe (entregadores e balcao). O painel nao fala com a Admin API do
 * Supabase direto porque isso exigiria a service_role no bundle publico.
 *
 * Acoes:
 *  - { email, password }          cria o usuario (ou reaproveita, ver abaixo)
 *  - { email, password, userId }  troca a senha de quem ja tem login
 *  - { userId, action: "delete" } apaga o login (usado ao remover da equipe)
 *
 * O reaproveitamento existe por um caso real: o e-mail e derivado do telefone,
 * entao cadastrar no balcao alguem que ja era entregador (ou refazer um cadastro
 * apagado) batia em 422 `email_exists` e a tela dizia so "salvar a senha falhou".
 * Agora, quando o e-mail ja existe, a senha e trocada no usuario existente e o
 * `id` dele volta para o painel vincular.
 */

const SUPABASE_URL = "https://pkyhdtaevvyziitpbkib.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreWhkdGFldnZ5emlpdHBia2liIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY2OTYwOSwiZXhwIjoyMDg5MjQ1NjA5fQ.mpNf4xfXYZkvzfUx7ehO29eFnswB2FcqwDZdL0_N97c";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Acha o usuario pelo e-mail exato. O `filter` do GoTrue casa por trecho. */
async function acharPorEmail(email) {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers },
  );
  if (!r.ok) return null;
  const d = await r.json();
  return (d.users ?? []).find((u) => u.email === email) ?? null;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { email, password, userId, action } = await req.json();

  // ── Apagar o login ──────────────────────────────────────────────────────────
  if (action === "delete") {
    if (!userId) return json({ error: "userId e obrigatorio para apagar" }, 400);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers,
    });
    // 404 = ja nao existe. Para quem esta removendo a pessoa da equipe, isso e
    // sucesso: o que importa e que o login nao entra mais.
    if (!r.ok && r.status !== 404) {
      const d = await r.json().catch(() => ({}));
      return json({ error: d.msg ?? d.error ?? `HTTP ${r.status}` }, r.status);
    }
    return json({ ok: true });
  }

  // ── Criar ou trocar senha ───────────────────────────────────────────────────
  if (!email || !password) {
    return json({ error: "email e password sao obrigatorios" }, 400);
  }

  if (userId) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ password }),
    });
    const d = await r.json();
    return json(d, r.ok ? 200 : r.status);
  }

  const criar = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const criado = await criar.json();
  if (criar.ok) return json(criado);

  if (criado.error_code === "email_exists" || criar.status === 422) {
    const existente = await acharPorEmail(email);
    if (existente) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existente.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (r.ok) return json({ ...d, reaproveitado: true });
      return json({ error: d.msg ?? d.error ?? `HTTP ${r.status}` }, r.status);
    }
  }

  return json(
    { error: criado.msg ?? criado.error ?? `HTTP ${criar.status}` },
    criar.status,
  );
}
