export const config = { runtime: "edge" };

const ZAPI_URL = "https://api.z-api.io/instances/3F0A5084BEF5A3D2D9500223DCEC427C/token/118387CD8676A8D266B0BC40/send-text";
const ZAPI_CLIENT_TOKEN = "Fc294ad65faf9466da2adbb87b7c37ce3S";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { phone, message } = await req.json();

  if (!phone || !message) {
    return new Response(JSON.stringify({ error: "phone e message são obrigatórios" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const r = await fetch(ZAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({ phone, message }),
  });

  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.ok ? 200 : r.status,
    headers: { "Content-Type": "application/json" },
  });
}
