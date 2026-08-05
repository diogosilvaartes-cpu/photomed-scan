export const config = { runtime: "edge" };

/**
 * Lê uma lista de produtos vinda de PDF ou TXT e devolve os itens estruturados.
 *
 * O PDF vai inteiro para o Claude (bloco `document`) em vez de ser convertido em
 * texto no browser: lista de farmácia costuma vir em tabela, e um extrator de
 * texto simples embaralha as colunas — o preço de uma linha acaba no produto de
 * cima. O modelo lê o layout.
 *
 * NÃO grava nada. Devolve a lista para o painel mostrar em prévia editável, e
 * quem confirma é a pessoa — importação automática de arquivo errado sujaria o
 * estoque que a Maria usa para responder o cliente.
 *
 * Exige ANTHROPIC_API_KEY na Vercel (a mesma do /api/analyze).
 */

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 8000;

const SCHEMA = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      description: "Um item por produto encontrado na lista",
      items: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do produto, sem a dosagem" },
          laboratorio: { type: "string", description: "Fabricante, ou vazio" },
          dosagem: { type: "string", description: "Ex: 500mg, ou vazio" },
          forma: { type: "string", description: "Ex: Comprimido, Xarope, ou vazio" },
          quantidade: { type: "number", description: "Unidades em estoque; 0 se nao informado" },
          preco: { type: "number", description: "Preco de venda em reais; 0 se nao informado" },
          lote: { type: "string", description: "Lote, ou vazio" },
          validade: { type: "string", description: "Validade em YYYY-MM, ou vazio" },
        },
        required: ["nome", "laboratorio", "dosagem", "forma", "quantidade", "preco", "lote", "validade"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};

const PROMPT =
  "Este arquivo e uma lista de produtos de uma farmacia. Extraia TODOS os produtos, um por item. " +
  "Regras: " +
  "1) Preco em reais como numero (1.234,56 vira 1234.56; R$ 7,50 vira 7.5). " +
  "2) Quantidade so o numero inteiro de unidades em estoque. " +
  "3) Campo que nao existir na lista fica string vazia, ou 0 nos numericos. NUNCA invente valor. " +
  "4) Separe a dosagem do nome: 'Dipirona 500mg' vira nome 'Dipirona' e dosagem '500mg'. " +
  "5) Ignore cabecalhos, rodapes, totais e numeros de pagina — so produtos. " +
  "6) Se o arquivo nao for uma lista de produtos, devolva a lista vazia.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY nao configurada no ambiente" }, 500);

  let texto, pdfBase64;
  try {
    ({ texto, pdfBase64 } = await req.json());
  } catch {
    return json({ error: "corpo invalido" }, 400);
  }

  if (!texto && !pdfBase64) return json({ error: "envie texto ou pdfBase64" }, 400);

  const conteudo = pdfBase64
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: PROMPT },
      ]
    : [{ type: "text", text: `${PROMPT}\n\n--- LISTA ---\n${String(texto).slice(0, 120000)}` }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: conteudo }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ error: data?.error?.message ?? "falha ao ler o arquivo" }, res.status);
  }
  if (data.stop_reason === "refusal") {
    return json({ error: "a leitura deste arquivo foi recusada pelo modelo" }, 422);
  }

  const saida = (data.content ?? [])
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("")
    .trim();

  if (!saida) return json({ error: "o modelo nao devolveu conteudo" }, 502);

  try {
    const parsed = JSON.parse(saida);
    return json({
      itens: Array.isArray(parsed.itens) ? parsed.itens : [],
      // Lista longa demais é cortada pelo max_tokens no meio; sem este aviso, o
      // balcão importaria metade do arquivo achando que veio tudo.
      truncado: data.stop_reason === "max_tokens",
    });
  } catch {
    return json({ error: "resposta do modelo nao veio como JSON valido" }, 502);
  }
}
