import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, User, Phone, MapPin, ShoppingBag, MessageSquare,
  ChevronRight, Loader2, Plus, X
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const ZAPI_BASE = "https://api.z-api.io/instances/3F083119DA06B00D1DE5BE013F70DD68/token/788EEF229294A3DE7108092A";
const ZAPI_CLIENT_TOKEN = "F703bb4394f324fb580948f20d063be15S";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  novo: { label: "Novo", color: "bg-blue-100 text-blue-700" },
  em_separacao: { label: "Em separação", color: "bg-orange-100 text-orange-700" },
  saiu_para_entrega: { label: "Saiu p/ entrega", color: "bg-purple-100 text-purple-700" },
  entregue: { label: "Entregue", color: "bg-green-100 text-green-700" },
  cancelado: { label: "Cancelado", color: "bg-red-100 text-red-700" },
};

type Cliente = {
  id: string;
  nome: string | null;
  telefone: string;
  endereco: string | null;
  enderecos: string[] | null;
  foto_url: string | null;
  observacoes: string | null;
  created_at: string;
};

type Pedido = {
  id: string;
  resumo: string | null;
  status: string;
  tipo_fulfillment: string;
  valor_total: number | null;
  pagamento: string | null;
  created_at: string;
  itens_pedido: { item: string; quantidade: number; observacao: string | null }[];
};

async function fetchClientes(search: string): Promise<Cliente[]> {
  let query = externalSupabase.from("clientes").select("*").order("updated_at", { ascending: false });
  if (search.trim()) query = query.or(`nome.ilike.%${search}%,telefone.ilike.%${search}%`);
  const { data, error } = await query.limit(100);
  if (error) throw error;
  return data ?? [];
}

async function fetchPedidosCliente(clienteId: string): Promise<Pedido[]> {
  const { data, error } = await externalSupabase
    .from("pedidos").select("*, itens_pedido(*)")
    .eq("cliente_id", clienteId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Pedido[];
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function ClientAvatar({ nome, fotoUrl, size = "sm" }: { nome: string | null; fotoUrl?: string | null; size?: "sm" | "lg" }) {
  const initials = (nome ?? "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const base = size === "lg"
    ? "w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden font-bold text-lg text-primary"
    : "w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden font-bold text-sm text-primary";
  return (
    <div className={base}>
      {fotoUrl
        ? <img src={fotoUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        : initials}
    </div>
  );
}

// ─── Drawer de detalhes ──────────────────────────────────────────────────────
function ClienteDrawer({ cliente, open, onClose, onEdit }: {
  cliente: Cliente | null; open: boolean; onClose: () => void; onEdit: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [obs, setObs] = useState(cliente?.observacoes ?? "");
  useEffect(() => { setObs(cliente?.observacoes ?? ""); }, [cliente]);

  const { data: pedidos, isLoading } = useQuery({
    queryKey: ["pedidos-cliente", cliente?.id],
    queryFn: () => fetchPedidosCliente(cliente!.id),
    enabled: !!cliente?.id && open,
  });

  const updateObs = useMutation({
    mutationFn: async (v: string) => {
      const { error } = await externalSupabase.from("clientes").update({ observacoes: v }).eq("id", cliente!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Observações salvas" }); qc.invalidateQueries({ queryKey: ["clientes"] }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  if (!cliente) return null;

  const allEnd = [
    ...(cliente.enderecos ?? []),
    ...(cliente.endereco && !cliente.enderecos?.includes(cliente.endereco) ? [cliente.endereco] : []),
  ].filter(Boolean);

  const totalGasto = pedidos?.filter((p) => p.status !== "cancelado").reduce((s, p) => s + (p.valor_total ?? 0), 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-3">
            <ClientAvatar nome={cliente.nome} fotoUrl={cliente.foto_url} size="lg" />
            <div>
              <div>{cliente.nome ?? cliente.telefone}</div>
              <div className="text-sm text-muted-foreground font-normal">{cliente.telefone}</div>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-2 mb-4">
          {allEnd.map((end, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0 mt-0.5" /><span>{end}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShoppingBag className="w-4 h-4 shrink-0" />
            <span>{pedidos?.length ?? 0} pedido(s) · R$ {totalGasto.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Cliente desde {format(new Date(cliente.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button size="sm" variant="outline" onClick={onEdit} className="flex-1">Editar dados</Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`https://wa.me/${cliente.telefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <Phone className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
            </a>
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="space-y-2 mb-6">
          <Label className="text-label">Observações internas</Label>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Preferências, alergias, notas..." rows={3} className="resize-none" />
          <Button size="sm" onClick={() => updateObs.mutate(obs)} disabled={updateObs.isPending}>
            {updateObs.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />} Salvar
          </Button>
        </div>

        <Separator className="my-4" />

        <h3 className="text-sm font-semibold mb-3">Histórico de pedidos</h3>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !pedidos?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido ainda.</p>
        ) : (
          <div className="space-y-3">
            {pedidos.map((p) => (
              <div key={p.id} className="bg-secondary rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <StatusBadge status={p.status} />
                  <span className="text-xs text-muted-foreground">{format(new Date(p.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                </div>
                {p.itens_pedido.length > 0 ? (
                  <ul className="text-sm space-y-0.5">
                    {p.itens_pedido.map((it, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span className="text-muted-foreground">×{it.quantidade}</span>
                        <span>{it.item}</span>
                        {it.observacao && <span className="text-muted-foreground text-xs">({it.observacao})</span>}
                      </li>
                    ))}
                  </ul>
                ) : p.resumo ? <p className="text-sm">{p.resumo}</p> : null}
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{p.tipo_fulfillment === "entrega" ? "Entrega" : "Retirada"}</span>
                  {p.valor_total ? <span className="font-medium text-foreground">R$ {p.valor_total.toFixed(2)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Modal criar / editar ────────────────────────────────────────────────────
function ClienteModal({ open, onClose, cliente }: { open: boolean; onClose: () => void; cliente?: Cliente | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [enderecos, setEnderecos] = useState<string[]>([]);
  const [novoEnd, setNovoEnd] = useState("");
  const [fetchingPhoto, setFetchingPhoto] = useState(false);
  const photoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setNome(cliente?.nome ?? "");
    setTelefone(cliente?.telefone ?? "");
    setFotoUrl(cliente?.foto_url ?? null);
    setEnderecos([
      ...(cliente?.enderecos ?? []),
      ...(cliente?.endereco && !cliente?.enderecos?.includes(cliente.endereco) ? [cliente.endereco] : []),
    ].filter(Boolean) as string[]);
    setNovoEnd("");
  }, [open, cliente]);

  function handleTelChange(val: string) {
    setTelefone(val);
    if (photoTimer.current) clearTimeout(photoTimer.current);
    const digits = val.replace(/\D/g, "");
    if (digits.length < 10) return;
    photoTimer.current = setTimeout(async () => {
      setFetchingPhoto(true);
      try {
        const res = await fetch(`${ZAPI_BASE}/profile-picture?phone=${digits}`, { headers: { "Client-Token": ZAPI_CLIENT_TOKEN } });
        const data = await res.json();
        if (data?.value) setFotoUrl(data.value);
      } catch { /* silent */ } finally { setFetchingPhoto(false); }
    }, 800);
  }

  function addEndereco() {
    const v = novoEnd.trim(); if (!v) return;
    setEnderecos((prev) => [...prev, v]); setNovoEnd("");
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        nome: nome.trim() || null,
        telefone: telefone.replace(/\D/g, ""),
        foto_url: fotoUrl,
        enderecos,
        endereco: enderecos[0] ?? null,
      };
      const { error } = cliente?.id
        ? await externalSupabase.from("clientes").update(payload).eq("id", cliente.id)
        : await externalSupabase.from("clientes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: cliente?.id ? "Cliente atualizado" : "Cliente cadastrado" });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erro: " + e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cliente?.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Foto preview */}
          <div className="flex items-center gap-4 p-3 bg-secondary rounded-xl">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 relative border border-border">
              {fetchingPhoto && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>}
              {fotoUrl ? <img src={fotoUrl} alt="" className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-primary" />}
            </div>
            <div className="text-sm">
              <p className="font-medium">Foto do WhatsApp</p>
              <p className="text-muted-foreground text-xs mt-0.5">Buscada automaticamente ao digitar o telefone</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn">Nome</Label>
            <Input id="cn" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" className="input-med" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct">Telefone (WhatsApp)</Label>
            <Input id="ct" value={telefone} onChange={(e) => handleTelChange(e.target.value)} placeholder="5521900000000" className="input-med" type="tel" />
          </div>

          <div className="space-y-2">
            <Label>Endereços de entrega</Label>
            {enderecos.map((end, i) => (
              <div key={i} className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">{end}</span>
                <button onClick={() => setEnderecos((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input value={novoEnd} onChange={(e) => setNovoEnd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEndereco())}
                placeholder="Rua, número, bairro" className="h-9 text-sm" />
              <Button type="button" size="sm" variant="outline" onClick={addEndereco}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !telefone.trim()}>
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {cliente?.id ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function Clientes() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Cliente | null>(null);

  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout((window as any).__searchTimeout);
    (window as any).__searchTimeout = setTimeout(() => setDebouncedSearch(value), 300);
  };

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["clientes", debouncedSearch],
    queryFn: () => fetchClientes(debouncedSearch),
  });

  // Auto-abre drawer quando ?id= está presente na URL
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (!idParam || !clientes) return;
    const found = clientes.find((c) => c.id === idParam);
    if (found) {
      setSelectedCliente(found);
      setDrawerOpen(true);
    } else {
      // Não está na lista atual (pode estar fora do limite) — busca direto
      externalSupabase.from("clientes").select("*").eq("id", idParam).single().then(({ data }) => {
        if (data) { setSelectedCliente(data as Cliente); setDrawerOpen(true); }
      });
    }
  }, [clientes, searchParams]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{clientes?.length ?? 0} cliente(s)</p>
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Novo cliente
        </Button>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9 input-med" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !clientes?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <User className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Nenhum cliente encontrado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clientes.map((c) => {
            const allEnd = [...(c.enderecos ?? []), ...(c.endereco && !c.enderecos?.includes(c.endereco) ? [c.endereco] : [])].filter(Boolean);
            return (
              <button key={c.id} onClick={() => { setSelectedCliente(c); setDrawerOpen(true); }}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-secondary transition-colors text-left">
                <ClientAvatar nome={c.nome} fotoUrl={c.foto_url} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.nome ?? "Sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{c.telefone}</p>
                </div>
                {allEnd.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground shrink-0 max-w-[180px]">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{allEnd[0]}</span>
                    {allEnd.length > 1 && <span className="text-primary font-medium shrink-0">+{allEnd.length - 1}</span>}
                  </div>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      <ClienteDrawer
        cliente={selectedCliente} open={drawerOpen} onClose={() => setDrawerOpen(false)}
        onEdit={() => { setEditTarget(selectedCliente); setDrawerOpen(false); setModalOpen(true); }}
      />
      <ClienteModal open={modalOpen} onClose={() => setModalOpen(false)} cliente={editTarget} />
    </div>
  );
}
