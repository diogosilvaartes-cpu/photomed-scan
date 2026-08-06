import { useRef, useState } from "react";
import {
  FileUp, Loader2, Plus, AlertTriangle, RefreshCw, PackagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { cn } from "@/lib/utils";

/**
 * Os dois caminhos de entrada do estoque: um produto na mão e uma lista inteira
 * de arquivo (PDF ou TXT).
 *
 * ⚠️ Item com `preco = 0` **não existe para a Maria**: o `Montar_Prompt` do
 * Ana_Agente filtra `preco > 0` ao montar o catálogo do WhatsApp. Por isso o
 * preço é destacado nos dois fluxos e a lista importada avisa quantos itens
 * vieram sem preço — senão o produto aparece no painel e some no atendimento.
 */

export type ItemImportado = {
  nome: string;
  laboratorio: string;
  dosagem: string;
  forma: string;
  quantidade: number;
  preco: number;
  lote: string;
  validade: string;
};

export type LinhaEstoque = {
  id: string;
  nome: string | null;
  dosagem: string | null;
};

/** Vazio vira NULL: string vazia em coluna de texto polui a busca e o prompt. */
const ouNulo = (v: string) => {
  const t = v.trim();
  return t === "" ? null : t;
};

const chaveDe = (nome: string | null, dosagem: string | null) =>
  `${(nome ?? "").trim().toLowerCase()}|${(dosagem ?? "").trim().toLowerCase()}`;

/**
 * Casa o item lido com o que já existe, por nome + dosagem. Sem isso, importar a
 * mesma lista duas vezes duplica o catálogo inteiro — e produto duplicado com
 * preço diferente já zerou um pedido antes.
 */
export function acharExistente(item: ItemImportado, atuais: LinhaEstoque[]): LinhaEstoque | null {
  const chave = chaveDe(item.nome, item.dosagem);
  return atuais.find((a) => chaveDe(a.nome, a.dosagem) === chave) ?? null;
}

// ─── Adicionar um produto ────────────────────────────────────────────────────

const VAZIO: ItemImportado = {
  nome: "", laboratorio: "", dosagem: "", forma: "",
  quantidade: 0, preco: 0, lote: "", validade: "",
};

export function NovoProdutoModal({ aberto, onFechar, onPronto }: {
  aberto: boolean;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState<ItemImportado>(VAZIO);
  const [salvando, setSalvando] = useState(false);

  function campo<K extends keyof ItemImportado>(k: K, v: ItemImportado[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function salvar() {
    if (!f.nome.trim()) {
      toast({ title: "O nome é obrigatório", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { error } = await externalSupabase.from("estoque").insert({
      nome: f.nome.trim(),
      laboratorio: ouNulo(f.laboratorio),
      dosagem: ouNulo(f.dosagem),
      forma: ouNulo(f.forma),
      quantidade: f.quantidade || 0,
      preco: f.preco || 0,
      lote: ouNulo(f.lote),
      validade: ouNulo(f.validade),
    });
    setSalvando(false);

    if (error) {
      toast({ title: "Não deu para salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `${f.nome.trim()} cadastrado`,
      description: f.preco > 0
        ? undefined
        : "Sem preço, ele não aparece para a Maria no WhatsApp. Defina o preço quando puder.",
    });
    setF(VAZIO);
    onPronto();
    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo produto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-nome">Nome *</Label>
            <Input id="p-nome" value={f.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="Dipirona" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-dose">Dosagem</Label>
              <Input id="p-dose" value={f.dosagem} onChange={(e) => campo("dosagem", e.target.value)} placeholder="500mg" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-forma">Forma</Label>
              <Input id="p-forma" value={f.forma} onChange={(e) => campo("forma", e.target.value)} placeholder="Comprimido" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-lab">Laboratório</Label>
            <Input id="p-lab" value={f.laboratorio} onChange={(e) => campo("laboratorio", e.target.value)} placeholder="EMS" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-qtd">Quantidade</Label>
              <Input id="p-qtd" type="number" min="0" value={f.quantidade || ""} onChange={(e) => campo("quantidade", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-preco">Preço (R$)</Label>
              <Input id="p-preco" type="number" min="0" step="0.01" value={f.preco || ""} onChange={(e) => campo("preco", Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-lote">Lote</Label>
              <Input id="p-lote" value={f.lote} onChange={(e) => campo("lote", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-val">Validade (AAAA-MM)</Label>
              <Input id="p-val" value={f.validade} onChange={(e) => campo("validade", e.target.value)} placeholder="2027-05" />
            </div>
          </div>

          {f.preco <= 0 && (
            <p className="flex items-start gap-1.5 text-xs text-status-ink-separacao bg-status-separacao/10 border border-status-separacao/25 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              Produto sem preço não é oferecido pela Maria no WhatsApp — ele fica só no painel.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={onFechar}>Cancelar</Button>
            <Button className="flex-1" onClick={salvar} disabled={salvando || !f.nome.trim()}>
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cadastrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Importar lista de arquivo ───────────────────────────────────────────────

type LinhaPrevia = ItemImportado & { incluir: boolean; existenteId: string | null };

export function ImportarEstoqueModal({ aberto, onFechar, atuais, onPronto }: {
  aberto: boolean;
  onFechar: () => void;
  atuais: LinhaEstoque[];
  onPronto: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [previa, setPrevia] = useState<LinhaPrevia[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState("");

  function fechar() {
    setPrevia(null);
    setTruncado(false);
    setNomeArquivo("");
    onFechar();
  }

  async function lerArquivo(file: File) {
    setLendo(true);
    setNomeArquivo(file.name);
    try {
      const ehPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      let corpo: Record<string, string>;

      if (ehPdf) {
        const buf = new Uint8Array(await file.arrayBuffer());
        // Em pedaços: `String.fromCharCode(...buf)` estoura a pilha em arquivo
        // grande, e uma lista de farmácia passa fácil de 1 MB.
        let bin = "";
        for (let i = 0; i < buf.length; i += 8192) {
          bin += String.fromCharCode(...buf.subarray(i, i + 8192));
        }
        corpo = { pdfBase64: btoa(bin) };
      } else {
        corpo = { texto: await file.text() };
      }

      const r = await fetch("/api/importar-estoque", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);

      const itens: ItemImportado[] = d.itens ?? [];
      if (itens.length === 0) {
        toast({
          title: "Nenhum produto encontrado",
          description: "O arquivo não parece ser uma lista de produtos.",
          variant: "destructive",
        });
        return;
      }

      setTruncado(!!d.truncado);
      setPrevia(itens.map((i) => {
        const existente = acharExistente(i, atuais);
        return { ...i, incluir: true, existenteId: existente?.id ?? null };
      }));
    } catch (e) {
      toast({
        title: "Não deu para ler o arquivo",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setLendo(false);
    }
  }

  function editar(idx: number, patch: Partial<LinhaPrevia>) {
    setPrevia((p) => p?.map((l, i) => (i === idx ? { ...l, ...patch } : l)) ?? null);
  }

  async function gravar() {
    if (!previa) return;
    const escolhidos = previa.filter((l) => l.incluir && l.nome.trim());
    if (escolhidos.length === 0) {
      toast({ title: "Nenhum item marcado", variant: "destructive" });
      return;
    }

    setGravando(true);
    try {
      // Quem já existe é ATUALIZADO (quantidade e preço), quem é novo entra.
      // Importar tudo como insert duplicaria o catálogo a cada lista nova.
      const novos = escolhidos.filter((l) => !l.existenteId);
      const existentes = escolhidos.filter((l) => l.existenteId);

      if (novos.length) {
        const { error } = await externalSupabase.from("estoque").insert(
          novos.map((l) => ({
            nome: l.nome.trim(),
            laboratorio: ouNulo(l.laboratorio),
            dosagem: ouNulo(l.dosagem),
            forma: ouNulo(l.forma),
            quantidade: l.quantidade || 0,
            preco: l.preco || 0,
            lote: ouNulo(l.lote),
            validade: ouNulo(l.validade),
          })),
        );
        if (error) throw error;
      }

      for (const l of existentes) {
        const { error } = await externalSupabase
          .from("estoque")
          .update({ quantidade: l.quantidade || 0, preco: l.preco || 0 })
          .eq("id", l.existenteId!);
        if (error) throw error;
      }

      const semPreco = escolhidos.filter((l) => !l.preco).length;
      toast({
        title: `${escolhidos.length} ${escolhidos.length === 1 ? "produto importado" : "produtos importados"}`,
        description: [
          novos.length ? `${novos.length} novo(s)` : null,
          existentes.length ? `${existentes.length} atualizado(s)` : null,
          semPreco ? `${semPreco} sem preço — esses não aparecem para a Maria` : null,
        ].filter(Boolean).join(" · "),
      });
      onPronto();
      fechar();
    } catch (e) {
      toast({
        title: "Falhou ao gravar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setGravando(false);
    }
  }

  const marcados = previa?.filter((l) => l.incluir).length ?? 0;
  const atualizacoes = previa?.filter((l) => l.incluir && l.existenteId).length ?? 0;

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar lista de estoque</DialogTitle>
        </DialogHeader>

        {!previa ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha um arquivo <b>PDF</b> ou <b>TXT</b> com a lista de produtos. O sistema lê,
              mostra o que encontrou e só grava depois que você conferir.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={lendo}
              className={cn(
                "w-full flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-12 transition-colors",
                lendo ? "opacity-70" : "hover:border-primary hover:bg-primary/5",
              )}
            >
              {lendo ? (
                <>
                  <Loader2 className="w-7 h-7 animate-spin text-primary" />
                  <span className="text-sm font-semibold">Lendo {nomeArquivo}...</span>
                  <span className="text-xs text-muted-foreground">Lista grande pode levar um minuto</span>
                </>
              ) : (
                <>
                  <FileUp className="w-7 h-7 text-muted-foreground" />
                  <span className="text-sm font-semibold">Escolher arquivo</span>
                  <span className="text-xs text-muted-foreground">PDF ou TXT</span>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) lerArquivo(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{previa.length} encontrados em {nomeArquivo}</span>
              {atualizacoes > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-status-novo/10 text-status-ink-novo">
                  <RefreshCw className="w-3 h-3" />
                  {atualizacoes} já existem e serão atualizados
                </span>
              )}
            </div>

            {truncado && (
              <p className="flex items-start gap-1.5 text-xs text-status-ink-cancelado bg-status-cancelado/10 border border-status-cancelado/25 rounded-lg px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                A lista era longa e a leitura foi cortada no meio. Importe estes e depois envie um
                arquivo com o restante.
              </p>
            )}

            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-left">Produto</th>
                    <th className="px-2 py-2 text-left w-24">Dosagem</th>
                    <th className="px-2 py-2 w-20">Qtd</th>
                    <th className="px-2 py-2 w-24">Preço</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {previa.map((l, i) => (
                    <tr key={i} className={cn(!l.incluir && "opacity-40")}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={l.incluir}
                          onChange={(e) => editar(i, { incluir: e.target.checked })}
                          className="w-4 h-4 accent-[hsl(var(--primary))]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={l.nome}
                          onChange={(e) => editar(i, { nome: e.target.value })}
                          className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
                        />
                        {l.existenteId && (
                          <span className="text-[10px] text-status-ink-novo font-semibold">já cadastrado</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={l.dosagem}
                          onChange={(e) => editar(i, { dosagem: e.target.value })}
                          className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" min="0"
                          value={l.quantidade || ""}
                          onChange={(e) => editar(i, { quantidade: Number(e.target.value) })}
                          className="w-full text-center bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" min="0" step="0.01"
                          value={l.preco || ""}
                          onChange={(e) => editar(i, { preco: Number(e.target.value) })}
                          className={cn(
                            "w-full text-center bg-transparent border-b focus:border-primary focus:outline-none",
                            l.preco ? "border-transparent hover:border-border" : "border-status-separacao/60",
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Dá para corrigir qualquer campo aqui antes de gravar. Item sem preço entra no
              painel, mas <b>não é oferecido pela Maria</b> no WhatsApp.
            </p>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setPrevia(null)}>
                Escolher outro arquivo
              </Button>
              <Button className="flex-1" onClick={gravar} disabled={gravando || marcados === 0}>
                {gravando
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <PackagePlus className="w-4 h-4 mr-2" />}
                Importar {marcados}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Botões do cabeçalho do Estoque. */
export function AcoesEstoque({ atuais, onPronto }: {
  atuais: LinhaEstoque[];
  onPronto: () => void;
}) {
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setImportar(true)}>
          <FileUp className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">Importar lista</span>
        </Button>
        <Button onClick={() => setNovo(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">Novo produto</span>
        </Button>
      </div>

      <NovoProdutoModal aberto={novo} onFechar={() => setNovo(false)} onPronto={onPronto} />
      <ImportarEstoqueModal
        aberto={importar}
        onFechar={() => setImportar(false)}
        atuais={atuais}
        onPronto={onPronto}
      />
    </>
  );
}
