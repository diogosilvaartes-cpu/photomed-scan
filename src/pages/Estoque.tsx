import { useEffect, useRef, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, PackageSearch, ImageOff, X, Upload, Check, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
}

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
        {prefix && <span className="text-xs text-gray-400">{prefix}</span>}
        <input
          ref={inputRef}
          type={type}
          step="0.01"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="w-20 border border-blue-300 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
        <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={open}
      title="Clique para editar"
      className="flex items-center gap-1 group hover:bg-blue-50 rounded px-1 -mx-1 transition-colors"
    >
      <span className={value == null ? "text-gray-300" : "font-semibold"}>
        {prefix}{value != null ? (type === "number" && !prefix ? value : value.toFixed(2)) : "—"}
      </span>
      <Pencil className="w-3 h-3 text-gray-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function FotoCell({ item, onUpdate }: { item: Medicamento; onUpdate: (url: string) => void }) {
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
        <button onClick={() => fileRef.current?.click()} title="Trocar foto" className="relative group">
          <img
            src={item.imagem_url}
            alt="embalagem"
            className="w-10 h-10 object-cover rounded-md border hover:opacity-70 transition-opacity mx-auto"
          />
          {uploading
            ? <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-md"><Loader2 className="w-4 h-4 animate-spin text-blue-500" /></div>
            : <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"><Upload className="w-3.5 h-3.5 text-white" /></div>
          }
        </button>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Adicionar foto"
          className="w-10 h-10 flex items-center justify-center rounded-md border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-colors mx-auto"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> : <Upload className="w-4 h-4 text-gray-300 hover:text-blue-400" />}
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
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await externalSupabase
        .from("estoque")
        .select("*")
        .order("nome", { ascending: true });
      setItems(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

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

  const groupNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const hoje = new Date().toISOString().slice(0, 7);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
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
        <div className="flex items-center gap-3 mb-6">
          <PackageSearch className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">Estoque de Medicamentos</h1>
          <Badge variant="secondary" className="ml-auto text-sm">
            {filtered.length} {filtered.length === 1 ? "item" : "itens"}
          </Badge>
        </div>

        <Input
          placeholder="Buscar por nome, laboratório, dosagem, forma, lote..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-6 bg-white"
        />

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            {search ? "Nenhum resultado para a busca." : "Nenhum medicamento cadastrado ainda."}
          </div>
        ) : (
          <div className="space-y-6">
            {groupNames.map((nome) => {
              const rows = grouped[nome];
              const totalQtd = rows.reduce((s, r) => s + (r.quantidade ?? 0), 0);
              return (
                <div key={nome} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                  <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between">
                    <span className="font-semibold text-blue-800">{nome}</span>
                    <Badge variant="outline" className="text-blue-700 border-blue-300">
                      Total: {totalQtd} un.
                    </Badge>
                  </div>

                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                      <tr>
                        <th className="px-3 py-2 text-center">Foto</th>
                        <th className="px-3 py-2 text-left">Laboratório</th>
                        <th className="px-3 py-2 text-left">Dosagem</th>
                        <th className="px-3 py-2 text-left">Forma</th>
                        <th className="px-3 py-2 text-center">Qtd</th>
                        <th className="px-3 py-2 text-center">Preço</th>
                        <th className="px-3 py-2 text-left">Lote</th>
                        <th className="px-3 py-2 text-left">Validade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((m) => {
                        const vencido = m.validade && m.validade < hoje;
                        return (
                          <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-3 text-center">
                              <FotoCell
                                item={m}
                                onUpdate={(url) => updateImagem(m.id, url)}
                              />
                            </td>
                            <td className="px-3 py-3 text-gray-700">{m.laboratorio ?? "—"}</td>
                            <td className="px-3 py-3 text-gray-700">{m.dosagem ?? "—"}</td>
                            <td className="px-3 py-3 text-gray-600">{m.forma ?? "—"}</td>
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
                            <td className="px-3 py-3 text-gray-600">{m.lote ?? "—"}</td>
                            <td className="px-3 py-3">
                              {m.validade ? (
                                <span className={vencido ? "text-red-600 font-semibold" : "text-green-700"}>
                                  {m.validade}{vencido && " ⚠️"}
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-gray-400 text-center mt-6">Clique em Qtd ou Preço para editar. Clique na foto (ou ícone) para fazer upload.</p>
      </div>
    </div>
  );
}
