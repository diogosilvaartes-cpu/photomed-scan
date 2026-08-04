export const config = { runtime: "edge" };

/**
 * Leitura da embalagem do medicamento (aba SCAN).
 *
 * Roda no servidor de propósito: antes o front chamava a OpenAI direto do
 * browser com `import.meta.env.VITE_OPENAI_API_KEY`, que não existe no `.env`
 * — saía `Authorization: Bearer undefined` e a OpenAI devolvia 401 em toda
 * leitura. Aqui a chave fica no ambiente da Vercel e nunca vai para o bundle.
 *
 * Usa o mesmo modelo que já lê rótulos no WhatsApp (Ana_Entrada) para manter
 * um provedor só. Exige ANTHROPIC_API_KEY na Vercel.
 */

const MODEL = "claude-haiku-4-5";

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Nome do medicamento" },
    lab: { type: "string", description: "Laboratorio fabricante" },
    dosage: { type: "string", description: "Dosagem, ex: 500mg" },
    pharmaForm: { type: "string", description: "Forma farmaceutica, ex: Comprimido" },
    quantity: { type: "string", description: "Quantidade de unidades na embalagem, so o numero" },
    batch: { type: "string", description: "Numero do lote, ou vazio se nao estiver visivel" },
    expiry: { type: "string", description: "Validade no formato YYYY-MM, ou vazio se nao estiver visivel" },
  },
  required: ["name", "lab", "dosage", "pharmaForm", "quantity", "batch", "expiry"],
  additionalProperties: false,
};

const PROMPT =
  "Analise a embalagem deste medicamento e extraia as informacoes do rotulo. " +
  "Preencha cada campo com o que estiver escrito na embalagem. " +
  "Se um campo nao estiver visivel ou legivel, deixe-o como string vazia — nao invente valores.";

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY nao configurada no ambiente" }, 500);
  }

  let base64, mimeType;
  try {
    ({ base64, mimeType } = await req.json());
  } catch {
    return json({ error: "corpo invalido" }, 400);
  }
  if (!base64) return json({ error: "base64 e obrigatorio" }, 400);

  const mediaType = MEDIA_TYPES.includes(mimeType) ? mimeType : "image/jpeg";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      // Saida estruturada: dispensa o parse de markdown/regex que o front fazia.
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return json({ error: data?.error?.message ?? "falha na leitura da imagem" }, res.status);
  }

  if (data.stop_reason === "refusal") {
    return json({ error: "a leitura desta imagem foi recusada pelo modelo" }, 422);
  }

  const texto = (data.content ?? [])
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("")
    .trim();

  if (!texto) {
    return json({ error: "o modelo nao devolveu conteudo" }, 502);
  }

  // Com output_config.format o texto ja e JSON valido; o try protege contra
  // um max_tokens que tenha cortado a resposta no meio.
  try {
    return json(JSON.parse(texto));
  } catch {
    return json({ error: "resposta do modelo nao veio como JSON valido" }, 502);
  }
}
