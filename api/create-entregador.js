export const config = { runtime: "edge" };

const SUPABASE_URL = "https://pkyhdtaevvyziitpbkib.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreWhkdGFldnZ5emlpdHBia2liIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY2OTYwOSwiZXhwIjoyMDg5MjQ1NjA5fQ.mpNf4xfXYZkvzfUx7ehO29eFnswB2FcqwDZdL0_N97c";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { email, password, userId } = await req.json();

  if (!email || !password) {
    return new Response(JSON.stringify({ error: "email e password são obrigatórios" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    apikey: SERVICE_ROLE_KEY,
  };

  let r;
  if (userId) {
    // Redefinir senha de usuário existente
    r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ password }),
    });
  } else {
    // Criar novo usuário confirmado
    r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
  }

  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.ok ? 200 : r.status,
    headers: { "Content-Type": "application/json" },
  });
}
