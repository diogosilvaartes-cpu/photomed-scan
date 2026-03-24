export const config = { runtime: "edge" };

const ZAPI_URL = "https://api.z-api.io/instances/3F083119DA06B00D1DE5BE013F70DD68/token/788EEF229294A3DE7108092A/send-text";
const ZAPI_CLIENT_TOKEN = "F703bb4394f324fb580948f20d063be15S";

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
