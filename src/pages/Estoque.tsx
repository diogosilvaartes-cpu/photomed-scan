import { useEffect, useState } from "react";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, PackageSearch, ImageOff, X } from "lucide-react";

interface Medicamento {
  id: string;
  nome: string | null;
  laboratorio: string | null;
  dosagem: string | null;
  forma: string | null;
  quantidade: number | null;
  lote: string | null;
  validade: string | null;
  imagem_url: string | null;
  criado_em: string | null;
}

export default function Estoque() {
  const [items, setItems] = useState<Medicamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

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

  // Group by nome
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
      {/* Lightbox */}
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

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <PackageSearch className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">Estoque de Medicamentos</h1>
          <Badge variant="secondary" className="ml-auto text-sm">
            {filtered.length} {filtered.length === 1 ? "item" : "itens"}
          </Badge>
        </div>

        {/* Search */}
        <Input
          placeholder="Buscar por nome, laboratório, dosagem, forma, lote..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-6 bg-white"
        />

        {/* Content */}
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
                  {/* Group header */}
                  <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between">
                    <span className="font-semibold text-blue-800">{nome}</span>
                    <Badge variant="outline" className="text-blue-700 border-blue-300">
                      Total: {totalQtd} un.
                    </Badge>
                  </div>

                  {/* Rows */}
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-2 text-center">Foto</th>
                        <th className="px-4 py-2 text-left">Laboratório</th>
                        <th className="px-4 py-2 text-left">Dosagem</th>
                        <th className="px-4 py-2 text-left">Forma</th>
                        <th className="px-4 py-2 text-center">Qtd</th>
                        <th className="px-4 py-2 text-left">Lote</th>
                        <th className="px-4 py-2 text-left">Validade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((m) => {
                        const vencido = m.validade && m.validade < hoje;
                        return (
                          <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-center">
                              {m.imagem_url ? (
                                <button onClick={() => setLightbox(m.imagem_url!)}>
                                  <img
                                    src={m.imagem_url}
                                    alt="embalagem"
                                    className="w-10 h-10 object-cover rounded-md border hover:opacity-80 transition-opacity mx-auto"
                                  />
                                </button>
                              ) : (
                                <ImageOff className="w-5 h-5 text-gray-300 mx-auto" />
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">{m.laboratorio ?? "—"}</td>
                            <td className="px-4 py-3 text-gray-700">{m.dosagem ?? "—"}</td>
                            <td className="px-4 py-3 text-gray-600">{m.forma ?? "—"}</td>
                            <td className="px-4 py-3 text-center font-semibold">{m.quantidade ?? "—"}</td>
                            <td className="px-4 py-3 text-gray-600">{m.lote ?? "—"}</td>
                            <td className="px-4 py-3">
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
      </div>
    </div>
  );
}
