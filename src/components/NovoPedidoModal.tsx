/**
 * Pedido criado internamente, pelo balcão — sem passar pela Maria no WhatsApp.
 *
 * Atalho para cliente recorrente: ao escolher o cliente, endereço, pagamento e
 * tipo de entrega vêm pré-preenchidos do último pedido dele. No caso comum
 * (mesmo cliente, mesmo endereço, mesma forma de pagamento) sobra escolher os
 * itens e salvar.
 *
 * Grava exatamente como o n8n grava: `pedidos` com status `novo` +
 * `itens_pedido`. Daí em diante o pedido segue o fluxo normal do Kanban.
 */
import { useEffect, useRef, useState } from "react";
import {
  Loader2, Search, User, Plus, X, Trash2, Package, MapPin, Check, ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { brl } from "@/lib/status";
import { calcularTaxa, carregarFreteConfig, FRETE_PADRAO, type FreteConfig } from "@/lib/frete";
import { cn } from "@/lib/utils";

const FORMAS_PAGAMENTO = ["PIX", "dinheiro", "débito", "crédito"];

/** Endereço novo digitado à mão, em vez de um dos já cadastrados. */
const OUTRO = "__outro__";

interface ClienteBusca {
  id: string;
  nome: string | null;
  telefone: string;
  endereco: string | null;
}

interface ItemEstoque {
  id: string;
  nome: string;
  preco: number | null;
  quantidade: number | null;
}

interface LinhaPedido {
  nome: string;
  quantidade: number;
  /** Unitário — editável, para desconto ou item cadastrado sem preço. */
  preco: number;
  observacao: string;
}

/** Telefone no formato que o banco e a Z-API usam: só dígitos, com DDI 55. */
function normalizarTelefone(bruto: string) {
  const d = bruto.replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("55") ? d : `55${d}`;
}

export default function NovoPedidoModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);

  // ─── cliente ───
  const [buscaCliente, setBuscaCliente] = useState("");
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [cliente, setCliente] = useState<ClienteBusca | null>(null);
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");

  // ─── entrega ───
  const [tipo, setTipo] = useState<"entrega" | "retirada">("entrega");
  const [enderecosCliente, setEnderecosCliente] = useState<string[]>([]);
  const [enderecoSel, setEnderecoSel] = useState<string>(OUTRO);
  const [enderecoLivre, setEnderecoLivre] = useState("");
  const [obsEntrega, setObsEntrega] = useState("");
  const [pessoaRecebimento, setPessoaRecebimento] = useState("");

  // ─── frete ───
  // A distância vem do atendente: o painel não geocodifica (ver src/lib/frete.ts).
  // `taxaInput` vazio significa "usar a taxa calculada" — quem digita, sobrepõe.
  const [freteCfg, setFreteCfg] = useState<FreteConfig>(FRETE_PADRAO);
  const [distanciaKm, setDistanciaKm] = useState("");
  const [taxaInput, setTaxaInput] = useState("");

  // ─── itens ───
  const [buscaItem, setBuscaItem] = useState("");
  const [sugestoes, setSugestoes] = useState<ItemEstoque[]>([]);
  const [linhas, setLinhas] = useState<LinhaPedido[]>([]);

  // ─── pagamento ───
  const [pagamento, setPagamento] = useState("PIX");

  const buscaClienteRef = useRef<HTMLInputElement>(null);

  function resetar() {
    setBuscaCliente(""); setResultados([]); setCliente(null);
    setCriandoCliente(false); setNovoNome(""); setNovoTelefone("");
    setTipo("entrega"); setEnderecosCliente([]); setEnderecoSel(OUTRO); setEnderecoLivre("");
    setObsEntrega(""); setPessoaRecebimento("");
    setDistanciaKm(""); setTaxaInput("");
    setBuscaItem(""); setSugestoes([]); setLinhas([]);
    setPagamento("PIX");
  }

  useEffect(() => {
    if (open) { resetar(); setTimeout(() => buscaClienteRef.current?.focus(), 80); }
  }, [open]);

  // A regra do frete mora em `configuracoes.frete_entrega` — relemos a cada abertura para
  // o balcão nunca cobrar por uma tabela antiga.
  useEffect(() => {
    if (open) carregarFreteConfig().then(setFreteCfg);
  }, [open]);

  // Busca de cliente (debounce) — some assim que um cliente é escolhido.
  useEffect(() => {
    if (cliente || !buscaCliente.trim()) { setResultados([]); return; }
    const termo = buscaCliente.trim();
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data } = await externalSupabase
        .from("clientes")
        .select("id, nome, telefone, endereco")
        .or(`nome.ilike.%${termo}%,telefone.ilike.%${termo}%`)
        .order("updated_at", { ascending: false })
        .limit(8);
      setResultados((data as ClienteBusca[]) ?? []);
      setBuscando(false);
    }, 250);
    return () => { clearTimeout(t); setBuscando(false); };
  }, [buscaCliente, cliente]);

  // Busca no estoque (debounce).
  useEffect(() => {
    if (!buscaItem.trim()) { setSugestoes([]); return; }
    const termo = buscaItem.trim();
    const t = setTimeout(async () => {
      const { data } = await externalSupabase
        .from("estoque")
        .select("id, nome, preco, quantidade")
        .ilike("nome", `%${termo}%`)
        .order("nome")
        .limit(8);
      setSugestoes((data as ItemEstoque[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaItem]);

  /**
   * Pré-preenche o pedido com o histórico do cliente: endereços cadastrados e
   * o que ele usou da última vez. É o que faz o pedido recorrente ser um
   * "escolher item e salvar".
   */
  async function escolherCliente(c: ClienteBusca) {
    setCliente(c);
    setResultados([]);
    setBuscaCliente("");

    const [{ data: ends }, { data: ultimos }] = await Promise.all([
      externalSupabase
        .from("enderecos")
        .select("label_exibicao, principal")
        .eq("cliente_id", c.id)
        .order("principal", { ascending: false }),
      externalSupabase
        .from("pedidos")
        .select("endereco, pagamento, tipo_fulfillment, obs_entrega, pessoa_recebimento")
        .eq("cliente_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const lista = [
      ...((ends ?? []).map((e) => e.label_exibicao).filter(Boolean) as string[]),
      ...(c.endereco ? [c.endereco] : []),
    ];
    const unicos = Array.from(new Set(lista));
    setEnderecosCliente(unicos);

    const ultimo = ultimos?.[0];
    if (ultimo?.tipo_fulfillment === "retirada") setTipo("retirada");
    if (ultimo?.pagamento) setPagamento(ultimo.pagamento);
    if (ultimo?.pessoa_recebimento) setPessoaRecebimento(ultimo.pessoa_recebimento);
    if (ultimo?.obs_entrega) setObsEntrega(ultimo.obs_entrega);

    // Endereço do último pedido primeiro; senão o principal; senão digitar.
    if (ultimo?.endereco && unicos.includes(ultimo.endereco)) setEnderecoSel(ultimo.endereco);
    else if (ultimo?.endereco) { setEnderecosCliente([ultimo.endereco, ...unicos]); setEnderecoSel(ultimo.endereco); }
    else if (unicos.length) setEnderecoSel(unicos[0]);
    else setEnderecoSel(OUTRO);
  }

  async function cadastrarCliente() {
    const tel = normalizarTelefone(novoTelefone);
    if (!novoNome.trim() || tel.length < 12) {
      toast({ title: "Preencha nome e telefone (com DDD)", variant: "destructive" });
      return;
    }
    // Telefone é UNIQUE: se já existe, aproveitamos o cadastro em vez de falhar.
    const { data: existente } = await externalSupabase
      .from("clientes").select("id, nome, telefone, endereco").eq("telefone", tel).maybeSingle();
    if (existente) {
      toast({ title: "Cliente já cadastrado", description: existente.nome ?? tel });
      setCriandoCliente(false);
      await escolherCliente(existente as ClienteBusca);
      return;
    }
    const { data, error } = await externalSupabase
      .from("clientes").insert({ nome: novoNome.trim(), telefone: tel })
      .select("id, nome, telefone, endereco").single();
    if (error) {
      toast({ title: "Erro ao cadastrar cliente", description: error.message, variant: "destructive" });
      return;
    }
    setCriandoCliente(false);
    setCliente(data as ClienteBusca);
    setEnderecosCliente([]);
    setEnderecoSel(OUTRO);
  }

  function adicionarItem(e: ItemEstoque) {
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.nome === e.nome);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], quantidade: copia[i].quantidade + 1 };
        return copia;
      }
      return [...prev, { nome: e.nome, quantidade: 1, preco: e.preco ?? 0, observacao: "" }];
    });
    setBuscaItem("");
    setSugestoes([]);
  }

  function adicionarLivre() {
    const nome = buscaItem.trim();
    if (!nome) return;
    setLinhas((prev) => [...prev, { nome, quantidade: 1, preco: 0, observacao: "" }]);
    setBuscaItem("");
    setSugestoes([]);
  }

  function alterarLinha(idx: number, campo: keyof LinhaPedido, valor: string | number) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  }

  const totalProdutos = linhas.reduce((s, l) => s + l.preco * l.quantidade, 0);

  // Frete: mesmo contrato do n8n — a taxa entra no valor_total e o detalhe fica nas colunas
  // taxa_entrega / distancia_km. Ver `Consolida_Pedido` (Ana_Agente) e `AGA_Calcular`.
  const kmDigitado = Number(distanciaKm.replace(",", "."));
  const km = distanciaKm.trim() && Number.isFinite(kmDigitado) ? kmDigitado : null;
  const freteCalc = calcularTaxa(km, freteCfg);
  const foraDeArea = tipo === "entrega" && freteCalc.foraDeArea;
  const taxaDigitada = Number(taxaInput.replace(",", "."));
  const taxaEntrega =
    tipo !== "entrega" || foraDeArea
      ? 0
      : taxaInput.trim() && Number.isFinite(taxaDigitada)
        ? Math.max(0, taxaDigitada)
        : freteCalc.taxa;
  const totalPedido = totalProdutos + taxaEntrega;

  const endereco = enderecoSel === OUTRO ? enderecoLivre.trim() : enderecoSel;
  const podeSalvar =
    !!cliente && linhas.length > 0 && (tipo === "retirada" || !!endereco) && !foraDeArea && !salvando;

  async function salvar() {
    if (!cliente) return;
    setSalvando(true);
    try {
      const resumoItens = linhas.map((l) => `${l.quantidade}x ${l.nome}`).join(", ");
      const { data: pedido, error } = await externalSupabase
        .from("pedidos")
        .insert({
          cliente_id: cliente.id,
          status: "novo",
          tipo_fulfillment: tipo,
          endereco: tipo === "entrega" ? endereco : null,
          pagamento,
          valor_total: totalPedido > 0 ? totalPedido : null,
          // `frete_conferir` fica false: a distância veio de humano, não do geocoder.
          taxa_entrega: tipo === "entrega" && taxaEntrega > 0 ? taxaEntrega : null,
          distancia_km: tipo === "entrega" ? km : null,
          frete_conferir: false,
          obs_entrega: obsEntrega.trim() || null,
          pessoa_recebimento: pessoaRecebimento.trim() || null,
          resumo: `Pedido do balcão — ${resumoItens}`,
        })
        .select("id, codigo")
        .single();
      if (error) throw new Error(error.message);

      const { error: errItens } = await externalSupabase.from("itens_pedido").insert(
        linhas.map((l) => ({
          pedido_id: pedido.id,
          item: l.nome,
          quantidade: l.quantidade,
          observacao: l.observacao.trim() || null,
        }))
      );
      if (errItens) throw new Error(errItens.message);

      // Endereço digitado à mão vira cadastro, para o próximo pedido já vir pronto.
      // Duplicata é esperada (UNIQUE por cliente+endereço normalizado) e ignorada.
      if (tipo === "entrega" && enderecoSel === OUTRO && endereco) {
        await externalSupabase
          .from("enderecos")
          .insert({ cliente_id: cliente.id, label_exibicao: endereco });
      }

      toast({
        title: `Pedido ${pedido.codigo ?? ""} criado`,
        description: `${cliente.nome ?? cliente.telefone} — ${brl(totalPedido)}`,
      });
      onDone();
      onClose();
    } catch (err: unknown) {
      toast({
        title: "Erro ao criar pedido",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !salvando) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            Novo pedido (balcão)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Cliente ── */}
          <section className="space-y-2">
            <Label>Cliente</Label>

            {cliente ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2">
                <User className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{cliente.nome ?? "Sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{cliente.telefone}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setCliente(null); setEnderecosCliente([]); setEnderecoSel(OUTRO); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                >
                  trocar
                </button>
              </div>
            ) : criandoCliente ? (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <Input placeholder="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                <Input
                  placeholder="Telefone com DDD (ex: 22988118535)"
                  inputMode="numeric"
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={cadastrarCliente}>
                    <Check className="w-4 h-4 mr-1" />Cadastrar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCriandoCliente(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    ref={buscaClienteRef}
                    className="pl-9"
                    placeholder="Buscar por nome ou telefone..."
                    value={buscaCliente}
                    onChange={(e) => setBuscaCliente(e.target.value)}
                  />
                  {buscando && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {resultados.length > 0 && (
                  <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                    {resultados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => escolherCliente(c)}
                        className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors"
                      >
                        <p className="text-sm font-medium truncate">{c.nome ?? "Sem nome"}</p>
                        <p className="text-xs text-muted-foreground">{c.telefone}</p>
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => { setCriandoCliente(true); setNovoNome(buscaCliente); }}
                >
                  <Plus className="w-4 h-4 mr-1" />Cliente novo
                </Button>
              </>
            )}
          </section>

          {/* ── Itens ── */}
          <section className="space-y-2">
            <Label>Itens</Label>
            <div className="relative">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar no estoque..."
                value={buscaItem}
                onChange={(e) => setBuscaItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (sugestoes.length) adicionarItem(sugestoes[0]);
                    else adicionarLivre();
                  }
                }}
              />
            </div>
            {sugestoes.length > 0 && (
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                {sugestoes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => adicionarItem(s)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-secondary transition-colors text-left"
                  >
                    <span className="text-sm truncate">{s.nome}</span>
                    <span className="text-xs shrink-0 text-muted-foreground">
                      {s.preco ? brl(s.preco) : "sem preço"}
                      {s.quantidade != null && ` · ${s.quantidade} un`}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {buscaItem.trim() && sugestoes.length === 0 && (
              <button
                type="button"
                onClick={adicionarLivre}
                className="text-xs text-primary hover:underline"
              >
                + adicionar "{buscaItem.trim()}" mesmo assim
              </button>
            )}

            {linhas.length > 0 && (
              <div className="space-y-2">
                {linhas.map((l, idx) => (
                  <div key={idx} className="rounded-xl border border-border p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium truncate">{l.nome}</span>
                      <button
                        type="button"
                        onClick={() => setLinhas((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-status-cancelado shrink-0"
                        aria-label={`Remover ${l.nome}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Qtd</span>
                        <Input
                          type="number" min={1} inputMode="numeric"
                          className="w-16 h-9"
                          value={l.quantidade}
                          onChange={(e) => alterarLinha(idx, "quantidade", Math.max(1, Number(e.target.value) || 1))}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">R$</span>
                        <Input
                          type="number" min={0} step="0.01" inputMode="decimal"
                          className="w-24 h-9"
                          value={l.preco}
                          onChange={(e) => alterarLinha(idx, "preco", Number(e.target.value) || 0)}
                        />
                      </div>
                      <Input
                        className="flex-1 h-9"
                        placeholder="obs. do item"
                        value={l.observacao}
                        onChange={(e) => alterarLinha(idx, "observacao", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                <div className="px-1 pt-2 border-t border-border space-y-1">
                  {taxaEntrega > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Produtos</span>
                        <span className="text-sm">{brl(totalProdutos)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Entrega</span>
                        <span className="text-sm">{brl(taxaEntrega)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-lg font-extrabold">{brl(totalPedido)}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── Entrega ── */}
          <section className="space-y-2">
            <Label>Entrega</Label>
            <div className="flex gap-2">
              {(["entrega", "retirada"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    "flex-1 h-10 rounded-xl text-sm font-semibold border transition-colors",
                    tipo === t
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "bg-background text-muted-foreground border-border hover:bg-secondary"
                  )}
                >
                  {t === "entrega" ? "Entregar" : "Retirar na loja"}
                </button>
              ))}
            </div>

            {tipo === "entrega" && (
              <>
                {enderecosCliente.length > 0 && (
                  <Select value={enderecoSel} onValueChange={setEnderecoSel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Endereço..." />
                    </SelectTrigger>
                    <SelectContent>
                      {enderecosCliente.map((e) => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                      <SelectItem value={OUTRO}>Outro endereço...</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {(enderecoSel === OUTRO || enderecosCliente.length === 0) && (
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Rua, número, bairro"
                      value={enderecoLivre}
                      onChange={(e) => setEnderecoLivre(e.target.value)}
                    />
                  </div>
                )}
                {/* Distância informada pelo atendente — o painel não geocodifica. A taxa sai
                    da regra em `configuracoes.frete_entrega`, a mesma que a Maria usa. */}
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Distância (km)</Label>
                    <Input
                      type="number" min={0} step="0.1" inputMode="decimal"
                      placeholder="ex.: 4,5"
                      value={distanciaKm}
                      onChange={(e) => setDistanciaKm(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Taxa de entrega</Label>
                    <Input
                      type="number" min={0} step="0.01" inputMode="decimal"
                      placeholder={freteCalc.foraDeArea ? "—" : brl(freteCalc.taxa)}
                      value={taxaInput}
                      onChange={(e) => setTaxaInput(e.target.value)}
                    />
                  </div>
                </div>
                {foraDeArea ? (
                  <p className="text-xs font-medium text-status-cancelado">
                    {distanciaKm} km passa do limite de {freteCfg.limite_km} km — a farmácia não entrega aí.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {brl(freteCfg.taxa_base)} até {freteCfg.raio_base_km} km, +{brl(freteCfg.taxa_por_km_extra)} por km
                    acima disso. Deixe a taxa em branco para usar a calculada.
                  </p>
                )}
                <Textarea
                  rows={2}
                  placeholder="Observação / ponto de referência (opcional)"
                  value={obsEntrega}
                  onChange={(e) => setObsEntrega(e.target.value)}
                />
                <Input
                  placeholder="Quem recebe (opcional)"
                  value={pessoaRecebimento}
                  onChange={(e) => setPessoaRecebimento(e.target.value)}
                />
              </>
            )}
          </section>

          {/* ── Pagamento ── */}
          <section className="space-y-2">
            <Label>Pagamento</Label>
            <div className="flex flex-wrap gap-2">
              {FORMAS_PAGAMENTO.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPagamento(f)}
                  className={cn(
                    "px-3 h-9 rounded-full text-sm font-semibold border transition-colors",
                    pagamento === f
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "bg-background text-muted-foreground border-border hover:bg-secondary"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={!podeSalvar}>
            {salvando
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Check className="w-4 h-4 mr-2" />}
            Criar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
