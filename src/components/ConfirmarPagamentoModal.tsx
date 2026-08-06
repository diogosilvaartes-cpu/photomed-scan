import { useEffect, useState } from "react";
import { Loader2, CheckCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ItemPagamento } from "@/lib/pedido";

const FORMAS = ["Dinheiro", "Pix", "Cartão Débito", "Cartão Crédito", "Outro"];

/**
 * Como foi pago de fato — usado tanto pelo entregador (marcar entrega na rua)
 * quanto pelo balcão (confirmar pelo Kanban/"Na rua" quando o entregador
 * ainda não registrou nada).
 */
export default function ConfirmarPagamentoModal({
  open,
  onClose,
  valorEsperado,
  itensIniciais,
  pending,
  onConfirmar,
  titulo = "Confirmar entrega",
  confirmLabel = "Confirmar entrega",
}: {
  open: boolean;
  onClose: () => void;
  valorEsperado: number | null | undefined;
  itensIniciais?: ItemPagamento[];
  pending: boolean;
  onConfirmar: (pagamentos: ItemPagamento[]) => void;
  titulo?: string;
  confirmLabel?: string;
}) {
  const [itens, setItens] = useState<ItemPagamento[]>([]);
  const [forma, setForma] = useState("Dinheiro");
  const [valor, setValor] = useState("");

  useEffect(() => {
    if (open) {
      setItens(itensIniciais ?? []);
      setForma("Dinheiro");
      setValor(valorEsperado?.toFixed(2) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function adicionar() {
    const v = parseFloat(valor.replace(",", "."));
    if (!v || v <= 0) return;
    setItens((p) => [...p, { forma, valor: v }]);
    setValor("");
  }

  const total = itens.reduce((s, i) => s + i.valor, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {valorEsperado != null && (
            <div className="flex justify-between items-center bg-secondary rounded-xl px-4 py-3">
              <span className="text-sm text-muted-foreground">Valor esperado</span>
              <span className="text-lg font-bold text-foreground">R$ {valorEsperado.toFixed(2)}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>Adicionar pagamento</Label>
            <div className="flex gap-2">
              <select
                value={forma}
                onChange={(e) => setForma(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1">
                {FORMAS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <Input
                type="number" step="0.01" min="0"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adicionar()}
                className="w-28" />
              <Button type="button" size="sm" variant="outline" onClick={adicionar}>+</Button>
            </div>
          </div>
          {itens.length > 0 && (
            <div className="space-y-1">
              {itens.map((p, i) => (
                <div key={i} className="flex justify-between items-center text-sm bg-secondary rounded-lg px-3 py-1.5">
                  <span>{p.forma}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">R$ {p.valor.toFixed(2)}</span>
                    <button onClick={() => setItens((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold px-3 pt-1">
                <span>Total recebido</span>
                <span className={total >= (valorEsperado ?? 0) ? "text-money" : "text-status-ink-separacao"}>
                  R$ {total.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirmar(itens)} disabled={pending}>
            {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
