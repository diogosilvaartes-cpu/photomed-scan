import { useCallback, useEffect, useRef, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, PackageSearch, X, Upload, Check, Pencil, Star, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { brl } from "@/lib/status";
import { AcoesEstoque } from "@/components/EstoqueModais";

interface Medicamento {
  id: string;
  nome: string | null;
  laboratorio: string | null;
  dosagem: string | null;
  forma: string | null;
  quantidade: number | null;
  preco: number | null;
  lote: string | null;
  validade: string | null;
  imagem_url: string | null;
  criado_em: string | null;
  /** Estrela do balcão: o que mais sai, fixado no topo da lista. */
  destaque: boolean | null;
}

/** Campos de texto editáveis no modal — a ordem aqui é a ordem do formulário. */
const CAMPOS_TEXTO: { campo: keyof Medicamento; label: string; tipo?: string; dica?: string }[] = [
  { campo: "nome", label: "Nome", dica: "É por este nome que a Maria encontra o produto no WhatsApp" },
  { campo: "laboratorio", label: "Laboratório" },
  { campo: "dosagem", label: "Dosagem", dica: "ex: 500mg" },
  { campo: "forma", label: "Forma", dica: "ex: comprimido, xarope" },
  { campo: "lote", label: "Lote" },
  { campo: "validade", label: "Validade", tipo: "month", dica: "AAAA-MM" },
];

const SUPABASE_URL = "https://pkyhdtaevvyziitpbkib.supabase.co";

function InlineEdit({
  value,
  onSave,
  type = "number",
  prefix,
}: {
  value: number | null;
  onSave: (v: number) => Promise<void>;
  type?: string;
  prefix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function open() {
    setDraft(String(value ?? ""));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function save() {
    const num = parseFloat(draft.replace(",", "."));
    if (isNaN(num) || num < 0) { setEditing(false); return; }
    setSaving(true);
    await onSave(num);
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        <input
          ref={inputRef}
          type={type}
          step="0.01"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="w-20 border border-status-novo/50 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />
        <button onClick={save} disabled={saving} className="text-money hover:text-status-ink-entregue">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-muted-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={open}
      title="Clique para editar"
      className="flex items-center gap-1 group hover:bg-status-novo/10 rounded px-1 -mx-1 transition-colors"
    >
      <span className={value == null ? "text-muted-foreground/60" : "font-semibold"}>
        {/* Dinheiro sempre por `brl()` — `toFixed(2)` cru saía "R$7.50", com ponto. */}
        {value == null ? "—" : prefix === "R$" ? brl(value) : `${prefix ?? ""}${value}`}
      </span>
      <Pencil className="w-3 h-3 text-muted-foreground/60 group-hover:text-status-novo/70 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

/**
 * Edição completa de um item — e a remoção.
 *
 * A tabela edita Qtd e Preço direto na linha, que é o que o balcão mexe todo
 * dia. O resto (nome, laboratório, dosagem, forma, lote, validade) só dava para
 * corrigir pelo Supabase: um item importado com nome errado ficava errado para
 * sempre, e é justamente o nome que a Maria usa para achar o produto.
 *
 * Remover pede confirmação com o nome à vista porque não há desfazer, e o item
 * pode estar em pedido antigo.
 */
function EditarItemModal({
  item,
  onClose,
  onSalvo,
  onRemovido,
}: {
  item: Medicamento;
  onClose: () => void;
  onSalvo: (m: Medicamento) => void;
  onRemovido: (id: string) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Medicamento>(item);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoRemover, setConfirmandoRemover] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  function set<K extends keyof Medicamento>(campo: K, valor: Medicamento[K]) {
    setDraft((d) => ({ ...d, [campo]: valor }));
  }

  async function salvar() {
    if (!draft.nome?.trim()) {
      toast({ title: "O nome é obrigatório", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const patch = {
      nome: draft.nome.trim(),
      laboratorio: draft.laboratorio?.trim() || null,
      dosagem: draft.dosagem?.trim() || null,
      forma: draft.forma?.trim() || null,
      lote: draft.lote?.trim() || null,
      validade: draft.validade?.trim() || null,
      quantidade: draft.quantidade,
      preco: draft.preco,
    };
    const { error } = await externalSupabase.from("estoque").update(patch).eq("id", item.id);
    setSalvando(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    onSalvo({ ...draft, ...patch });
    toast({ title: "Item atualizado!" });
    onClose();
  }

  async function remover() {
    setRemovendo(true);
    const { error } = await externalSupabase.from("estoque").delete().eq("id", item.id);
    setRemovendo(false);
    if (error) {
      toast({ title: "Não deu para remover", description: error.message, variant: "destructive" });
      return;
    }
    onRemovido(item.id);
    toast({ title: "Item removido do estoque" });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-foreground">Editar item</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {CAMPOS_TEXTO.map(({ campo, label, tipo, dica }) => (
            <div key={String(campo)}>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</label>
              <Input
                type={tipo ?? "text"}
                value={(draft[campo] as string | null) ?? ""}
                onChange={(e) => set(campo, e.target.value as Medicamento[typeof campo])}
                placeholder={dica}
              />
              {dica && <p className="mt-0.5 text-[11px] text-muted-foreground">{dica}</p>}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Quantidade</label>
              <Input
                type="number"
                min="0"
                value={draft.quantidade ?? ""}
                onChange={(e) => set("quantidade", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Preço (R$)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.preco ?? ""}
                onChange={(e) => set("preco", e.target.value === "" ? null : Number(e.target.value))}
              />
              {!draft.preco && (
                <p className="mt-0.5 text-[11px] text-status-ink-separacao">
                  Sem preço, a Maria não oferece este item.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={salvar}
            disabled={salvando}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Salvar
          </button>
          <button
            onClick={onClose}
            className="h-10 rounded-xl border border-border px-4 text-sm font-semibold"
          >
            Cancelar
          </button>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          {confirmandoRemover ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
              <p className="mb-2 text-sm font-semibold text-destructive">
                Remover “{item.nome ?? "sem nome"}” do estoque? Não dá para desfazer.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={remover}
                  disabled={removendo}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-destructive text-sm font-bold text-destructive-foreground disabled:opacity-60"
                >
                  {removendo && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sim, remover
                </button>
                <button
                  onClick={() => setConfirmandoRemover(false)}
                  className="h-9 rounded-lg border border-border px-3 text-sm"
                >
                  Voltar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmandoRemover(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-destructive hover:underline"
            >
              <Trash2 className="h-4 w-4" />
              Remover do estoque
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FotoCell({
  item,
  onUpdate,
  onZoom,
}: {
  item: Medicamento;
  onUpdate: (url: string) => void;
  onZoom: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${item.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await externalSupabase.storage
        .from("medicamentos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = externalSupabase.storage
        .from("medicamentos")
        .getPublicUrl(path);

      const { error: dbErr } = await externalSupabase
        .from("estoque")
        .update({ imagem_url: publicUrl })
        .eq("id", item.id);
      if (dbErr) throw dbErr;

      onUpdate(publicUrl);
      toast({ title: "Foto atualizada!" });
    } catch (e) {
      toast({ title: "Erro ao enviar foto", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {item.imagem_url ? (
        <div className="relative group w-10 h-10 mx-auto">
          <button
            onClick={() => onZoom(item.imagem_url!)}
            title="Ampliar foto"
            className="block w-10 h-10"
          >
            <img
              src={item.imagem_url}
              alt="embalagem"
              className="w-10 h-10 object-cover rounded-md border hover:opacity-70 transition-opacity"
            />
          </button>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-md">
              <Loader2 className="w-4 h-4 animate-spin text-status-novo" />
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            title="Trocar foto"
            className="absolute -bottom-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full bg-status-novo text-white opacity-0 group-hover:opacity-100 transition-opacity shadow"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Adicionar foto"
          className="w-10 h-10 flex items-center justify-center rounded-md border border-dashed border-border hover:border-status-novo hover:bg-status-novo/10 transition-colors mx-auto"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin text-status-novo" /> : <Upload className="w-4 h-4 text-muted-foreground/60 hover:text-status-novo/70" />}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

export default function Estoque() {
  const [items, setItems] = useState<Medicamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editando, setEditando] = useState<Medicamento | null>(null);
  const { toast } = useToast();

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    const { data } = await externalSupabase
      .from("estoque")
      .select("*")
      .order("nome", { ascending: true });
    setItems(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function updateField(id: string, field: "quantidade" | "preco", value: number) {
    const { error } = await externalSupabase
      .from("estoque")
      .update({ [field]: value })
      .eq("id", id);
    if (error) {
      toast({ title: "Erro ao salvar", variant: "destructive" });
      throw error;
    }
    setItems((prev) => prev.map((m) => m.id === id ? { ...m, [field]: value } : m));
  }

  function updateImagem(id: string, url: string) {
    setItems((prev) => prev.map((m) => m.id === id ? { ...m, imagem_url: url } : m));
  }

  /** Estrela: o que mais sai fica fixado no topo, fora da ordem alfabética. */
  async function alternarDestaque(m: Medicamento) {
    const novo = !m.destaque;
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, destaque: novo } : x)));
    const { error } = await externalSupabase.from("estoque").update({ destaque: novo }).eq("id", m.id);
    if (error) {
      // Volta ao estado anterior: estrela que "gruda" sem ter salvo é pior que não ter.
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, destaque: !novo } : x)));
      toast({ title: "Não deu para destacar", variant: "destructive" });
    }
  }

  const filtered = items.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.nome?.toLowerCase().includes(q) ||
      m.laboratorio?.toLowerCase().includes(q) ||
      m.dosagem?.toLowerCase().includes(q) ||
      m.forma?.toLowerCase().includes(q) ||
      m.lote?.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, Medicamento[]>>((acc, m) => {
    const key = m.nome ?? "—";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  // Grupo com estrela sobe para o topo; o resto segue alfabético. Basta um item
  // destacado para o grupo inteiro subir — a estrela é do produto, e o produto
  // aqui é o grupo (as linhas são lotes/apresentações do mesmo nome).
  const grupoDestacado = (nome: string) => grouped[nome].some((m) => m.destaque);
  const groupNames = Object.keys(grouped).sort((a, b) => {
    const da = grupoDestacado(a), db = grupoDestacado(b);
    if (da !== db) return da ? -1 : 1;
    return a.localeCompare(b, "pt-BR");
  });
  const hoje = new Date().toISOString().slice(0, 7);
  const semPreco = items.filter((m) => !m.preco).length;

  return (
    <div className="min-h-screen bg-muted/50 p-6">
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}>
            <X className="w-7 h-7" />
          </button>
          <img
            src={lightbox}
            alt="Embalagem"
            className="max-h-[90vh] max-w-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <PackageSearch className="w-6 h-6 text-status-ink-novo" />
          <h1 className="text-2xl font-bold text-foreground">Estoque de Medicamentos</h1>
          <Badge variant="secondary" className="text-sm">
            {filtered.length} {filtered.length === 1 ? "item" : "itens"}
          </Badge>
          <div className="ml-auto">
            <AcoesEstoque
              atuais={items.map((m) => ({ id: m.id, nome: m.nome, dosagem: m.dosagem }))}
              onPronto={() => carregar(true)}
            />
          </div>
        </div>

        <Input
          placeholder="Buscar por nome, laboratório, dosagem, forma, lote..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-6 bg-white"
        />

        {/* Item sem preço não existe para a Maria: o Montar_Prompt do Ana_Agente
            filtra `preco > 0`. Sem este aviso, o produto aparece aqui e some no
            WhatsApp — já aconteceu de zerar um pedido agendado. */}
        {!loading && semPreco > 0 && (
          <p className="mb-4 text-sm text-status-ink-separacao bg-status-separacao/10 border border-status-separacao/25 rounded-xl px-3 py-2">
            <b>{semPreco}</b> {semPreco === 1 ? "produto está" : "produtos estão"} sem preço e
            {semPreco === 1 ? " não é oferecido" : " não são oferecidos"} pela Maria no WhatsApp.
            Clique no preço para definir.
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-status-novo" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            {search ? "Nenhum resultado para a busca." : "Nenhum medicamento cadastrado ainda."}
          </div>
        ) : (
          <div className="space-y-6">
            {groupNames.map((nome) => {
              const rows = grouped[nome];
              const totalQtd = rows.reduce((s, r) => s + (r.quantidade ?? 0), 0);
              return (
                <div key={nome} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                  <div className="bg-status-novo/10 border-b border-status-novo/25 px-4 py-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-status-ink-novo">
                      {grupoDestacado(nome) && (
                        <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" />
                      )}
                      {nome}
                    </span>
                    <Badge variant="outline" className="text-status-ink-novo border-status-novo/50">
                      Total: {totalQtd} un.
                    </Badge>
                  </div>

                  {/* Rolagem própria: sem isso o navegador espremia as 9 colunas
                      dentro da tela no mobile (o overflow-hidden do wrapper, que
                      só existe pra arredondar os cantos, cortava em vez de rolar). */}
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
                      <tr>
                        <th className="px-3 py-2 text-center">Foto</th>
                        <th className="px-3 py-2 text-left">Laboratório</th>
                        <th className="px-3 py-2 text-left">Dosagem</th>
                        <th className="px-3 py-2 text-left">Forma</th>
                        <th className="px-3 py-2 text-center">Qtd</th>
                        <th className="px-3 py-2 text-center">Preço</th>
                        <th className="px-3 py-2 text-left">Lote</th>
                        <th className="px-3 py-2 text-left">Validade</th>
                        <th className="px-3 py-2 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((m) => {
                        const vencido = m.validade && m.validade < hoje;
                        return (
                          <tr key={m.id} className="hover:bg-muted/50 transition-colors">
                            <td className="px-3 py-3 text-center">
                              <FotoCell
                                item={m}
                                onUpdate={(url) => updateImagem(m.id, url)}
                                onZoom={setLightbox}
                              />
                            </td>
                            <td className="px-3 py-3 text-foreground">{m.laboratorio ?? "—"}</td>
                            <td className="px-3 py-3 text-foreground">{m.dosagem ?? "—"}</td>
                            <td className="px-3 py-3 text-muted-foreground">{m.forma ?? "—"}</td>
                            <td className="px-3 py-3 text-center">
                              <InlineEdit
                                value={m.quantidade}
                                onSave={(v) => updateField(m.id, "quantidade", v)}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <InlineEdit
                                value={m.preco}
                                onSave={(v) => updateField(m.id, "preco", v)}
                                prefix="R$"
                              />
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{m.lote ?? "—"}</td>
                            <td className="px-3 py-3">
                              {m.validade ? (
                                <span className={vencido ? "text-status-ink-cancelado font-semibold" : "text-status-ink-entregue"}>
                                  {m.validade}{vencido && " ⚠️"}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => alternarDestaque(m)}
                                  title={m.destaque ? "Tirar destaque" : "Destacar item"}
                                  aria-pressed={!!m.destaque}
                                  className="rounded p-1 transition-colors hover:bg-muted"
                                >
                                  <Star
                                    className={
                                      m.destaque
                                        ? "h-4 w-4 fill-amber-400 text-amber-500"
                                        : "h-4 w-4 text-muted-foreground/40 hover:text-amber-400"
                                    }
                                  />
                                </button>
                                <button
                                  onClick={() => setEditando(m)}
                                  title="Editar todos os campos / remover"
                                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-status-ink-novo"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground text-center mt-6">
          Clique em Qtd ou Preço para editar na hora · ⭐ destaca o item no topo ·
          ✏️ abre todos os campos e a remoção · clique na foto para ampliar, no lápis para trocar.
        </p>
      </div>

      {editando && (
        <EditarItemModal
          item={editando}
          onClose={() => setEditando(null)}
          onSalvo={(m) => setItems((prev) => prev.map((x) => (x.id === m.id ? m : x)))}
          onRemovido={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
        />
      )}
    </div>
  );
}
