export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { base64, mimeType } = await req.json();

  const apiKey = process.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
            {
              type: "text",
              text: `Analise a embalagem deste medicamento e extraia as informações. Responda SOMENTE com um JSON válido, sem markdown, sem explicações, no formato:
{
  "name": "nome do medicamento",
  "lab": "laboratório fabricante",
  "dosage": "dosagem ex: 500mg",
  "pharmaForm": "forma farmacêutica ex: Comprimido",
  "quantity": "quantidade numérica de unidades na embalagem",
  "batch": "número do lote ou vazio se não visível",
  "expiry": "validade no formato YYYY-MM ou vazio se não visível"
}`,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return new Response(JSON.stringify({ error: data }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return new Response(clean, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
