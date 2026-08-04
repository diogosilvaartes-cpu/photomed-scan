import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Truck, Users, History, Loader2, MapPin, Phone, Navigation, KeyRound,
  Clock, CheckCircle, AlertTriangle, Radio, Package, TrendingUp, Search,
  LocateFixed, Camera, DollarSign, PackageCheck, UserPlus, Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase, pinToPassword } from "@/integrations/supabase/external-client";
import { cn } from "@/lib/utils";
import { brl, moneyClass } from "@/lib/status";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ItemPagamento = { forma: string; valor: number };

interface EntregadorRow {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
  user_id: string | null;
  created_at: string;
}

interface DespachoFull {
  id: string;
  pedido_id: string;
  entregador_id: string | null;
  status_entrega: string;
  observacao: string | null;
  fotos: string[] | null;
  localizacao: string | null;
  enviado_em: string;
  saiu_em: string | null;
  chegou_em: string | null;
  entregue_em: string | null;
  pagamento_recebido: ItemPagamento[] | null;
  pedidos: {
    id: string;
    status: string | null;
    endereco: string | null;
    valor_total: number | null;
    pagamento: string | null;
    created_at: string | null;
    clientes: { nome: string | null; telefone: string | null } | null;
  } | null;
  entregadores: { id: string; nome: string; telefone: string; ativo: boolean } | null;
}

// Minutos a partir dos quais uma entrega em rua é considerada atrasada
const SLA_MINUTOS = 45;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutosEntre(inicio: string | null, fim: string | null) {
  if (!inicio || !fim) return null;
  return (new Date(fim).getTime() - new Date(inicio).getTime()) / 60000;
}

function minutosDesde(dateStr: string | null) {
  if (!dateStr) return null;
  return (Date.now() - new Date(dateStr).getTime()) / 60000;
}

function duracaoCurta(min: number | null) {
  if (min == null) return "—";
  if (min < 1) return "<1min";
  if (min < 60) return `${Math.floor(min)}min`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = Math.floor(min % 60);
    return m ? `${h}h${m}` : `${h}h`;
  }
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return h ? `${d}d${h}h` : `${d}d`;
}

function parseCoords(str: string | null): [number, number] | null {
  if (!str) return null;
  const m = str.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function mapsLink(endereco: string) {
  return parseCoords(endereco)
    ? `https://maps.google.com/?q=${endereco}`
    : `https://maps.google.com/?q=${encodeURIComponent(endereco)}`;
}

function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function totalRecebido(pg: ItemPagamento[] | null) {
  if (!pg?.length) return 0;
  return pg.reduce((s, p) => s + (Number(p.valor) || 0), 0);
}

/** Um despacho está "na rua" enquanto não foi entregue nem cancelado. */
function estaAtivo(d: DespachoFull) {
  const st = d.pedidos?.status;
  if (st === "cancelado" || st === "entregue" || st === "retirado") return false;
  return !d.entregue_em && d.status_entrega !== "entregue";
}

/** Etapa atual da entrega, usada no stepper e na cor do pino. */
function etapaAtual(d: DespachoFull): "despachado" | "saiu" | "chegou" | "entregue" {
  if (d.entregue_em || d.status_entrega === "entregue") return "entregue";
  if (d.chegou_em) return "chegou";
  if (d.saiu_em) return "saiu";
  return "despachado";
}

const ETAPA_COR: Record<string, string> = {
  despachado: "#6366f1", // indigo
  saiu: "#7c3aed",       // violeta
  chegou: "#f59e0b",     // âmbar
  entregue: "#059669",   // esmeralda
};

const ETAPA_LABEL: Record<string, string> = {
  despachado: "Despachado",
  saiu: "Na rua",
  chegou: "No local",
  entregue: "Entregue",
};

// ─── Busca de dados ───────────────────────────────────────────────────────────

async function fetchDespachos(): Promise<DespachoFull[]> {
  const { data, error } = await externalSupabase
    .from("despacho_entrega")
    .select(`
      id, pedido_id, entregador_id, status_entrega, observacao, fotos, localizacao,
      enviado_em, saiu_em, chegou_em, entregue_em, pagamento_recebido,
      pedidos ( id, status, endereco, valor_total, pagamento, created_at,
                clientes ( nome, telefone ) ),
      entregadores ( id, nome, telefone, ativo )
    `)
    .order("enviado_em", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as DespachoFull[];
}

async function fetchEntregadores(): Promise<EntregadorRow[]> {
  const { data, error } = await externalSupabase
    .from("entregadores")
    .select("id, nome, telefone, ativo, user_id, created_at")
    .order("nome");
  if (error) throw error;
  return (data ?? []) as EntregadorRow[];
}

// ─── Mapa ─────────────────────────────────────────────────────────────────────

function pinoEntregador(nome: string, etapa: string) {
  const cor = ETAPA_COR[etapa] ?? "#6366f1";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${cor};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font:700 12px/1 system-ui,sans-serif;
      border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
    ">${iniciais(nome)}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

const pinoDestino = L.divIcon({
  className: "",
  html: `<div style="
    width:22px;height:22px;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    background:#ef4444;border:2px solid #fff;
    box-shadow:0 2px 6px rgba(0,0,0,.3);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

/** Ajusta o zoom para caber todos os pinos sempre que eles mudam. */
function AjustarBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const chave = pontos.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (!pontos.length) return;
    if (pontos.length === 1) {
      map.setView(pontos[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40], maxZoom: 16 });
    }
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function MapaAoVivo({ despachos }: { despachos: DespachoFull[] }) {
  const entregadoresComGps = despachos.filter((d) => parseCoords(d.localizacao));
  const destinos = despachos
    .map((d) => ({ d, coords: parseCoords(d.pedidos?.endereco ?? null) }))
    .filter((x) => x.coords);

  const pontos: [number, number][] = [
    ...entregadoresComGps.map((d) => parseCoords(d.localizacao)!),
    ...destinos.map((x) => x.coords!),
  ];

  // Centro padrão: Rio de Janeiro, usado quando ninguém compartilhou GPS ainda
  const centro: [number, number] = pontos[0] ?? [-22.9068, -43.1729];

  if (!pontos.length) {
    return (
      <div className="h-[320px] rounded-xl border border-border bg-secondary/40 flex flex-col items-center justify-center text-center px-6">
        <LocateFixed className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm font-medium text-foreground">Nenhuma posição no mapa</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Os pinos aparecem quando o entregador toca em “Compartilhar localização” no app dele.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[320px] rounded-xl overflow-hidden border border-border relative z-0">
      <MapContainer center={centro} zoom={13} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AjustarBounds pontos={pontos} />

        {entregadoresComGps.map((d) => {
          const coords = parseCoords(d.localizacao)!;
          const nome = d.entregadores?.nome ?? "Entregador";
          const etapa = etapaAtual(d);
          return (
            <Marker key={`e-${d.id}`} position={coords} icon={pinoEntregador(nome, etapa)}>
              <Popup>
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-sm">{nome}</p>
                  <p className="text-muted-foreground">{ETAPA_LABEL[etapa]}</p>
                  <p>Cliente: {d.pedidos?.clientes?.nome ?? d.pedidos?.clientes?.telefone ?? "—"}</p>
                  {d.pedidos?.endereco && <p>{d.pedidos.endereco}</p>}
                  <a
                    href={`https://maps.google.com/?q=${coords[0]},${coords[1]}`}
                    target="_blank" rel="noreferrer"
                    className="text-primary font-medium inline-block pt-1"
                  >
                    Abrir no Google Maps
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {destinos.map(({ d, coords }) => (
          <Marker key={`d-${d.id}`} position={coords!} icon={pinoDestino}>
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-semibold text-sm">Destino</p>
                <p>{d.pedidos?.clientes?.nome ?? d.pedidos?.clientes?.telefone ?? "—"}</p>
                {d.pedidos?.endereco && <p className="text-muted-foreground">{d.pedidos.endereco}</p>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// ─── Aba: Ao vivo ─────────────────────────────────────────────────────────────

function Stepper({ d }: { d: DespachoFull }) {
  const etapas = [
    { key: "despachado", label: "Despachado", em: d.enviado_em },
    { key: "saiu", label: "Saiu", em: d.saiu_em },
    { key: "chegou", label: "Chegou", em: d.chegou_em },
    { key: "entregue", label: "Entregue", em: d.entregue_em },
  ];
  return (
    <div className="flex items-center gap-1">
      {etapas.map((e, i) => {
        const feito = !!e.em;
        return (
          <div key={e.key} className="flex items-center gap-1 flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div
                className={cn(
                  "w-2.5 h-2.5 rounded-full border-2",
                  feito ? "bg-primary border-primary" : "bg-background border-border"
                )}
              />
              <span className={cn("text-[10px] leading-none", feito ? "text-foreground font-medium" : "text-muted-foreground")}>
                {e.label}
              </span>
              <span className="text-[9px] text-muted-foreground leading-none h-2.5">
                {e.em ? format(new Date(e.em), "HH:mm") : ""}
              </span>
            </div>
            {i < etapas.length - 1 && (
              <div className={cn("h-0.5 flex-1 rounded", etapas[i + 1].em ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CardAoVivo({ d }: { d: DespachoFull }) {
  const etapa = etapaAtual(d);
  const cliente = d.pedidos?.clientes?.nome ?? d.pedidos?.clientes?.telefone ?? "—";
  const telCliente = d.pedidos?.clientes?.telefone;
  const decorrido = minutosDesde(d.saiu_em ?? d.enviado_em);
  const atrasada = d.saiu_em != null && (minutosDesde(d.saiu_em) ?? 0) > SLA_MINUTOS;
  const gps = parseCoords(d.localizacao);

  return (
    <div
      className={cn(
        "bg-card border rounded-xl p-4 space-y-3",
        atrasada ? "border-red-400 ring-1 ring-red-200" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ background: ETAPA_COR[etapa] }}
        >
          {iniciais(d.entregadores?.nome ?? "?")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground truncate">
              {d.entregadores?.nome ?? "Sem entregador"}
            </p>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ background: ETAPA_COR[etapa] }}
            >
              {ETAPA_LABEL[etapa]}
            </span>
            {atrasada && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                <AlertTriangle className="w-3 h-3" /> Atrasada
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {cliente} · há {duracaoCurta(decorrido)}
          </p>
        </div>
        {d.pedidos?.valor_total != null && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground">A receber</p>
            <p className={cn("text-sm", moneyClass(d.pedidos.valor_total))}>{brl(d.pedidos.valor_total)}</p>
          </div>
        )}
      </div>

      {d.pedidos?.endereco && (
        <div className="flex items-start gap-2 bg-secondary rounded-lg px-3 py-2">
          <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <span className="text-xs flex-1 min-w-0 break-words">{d.pedidos.endereco}</span>
        </div>
      )}

      <Stepper d={d} />

      {d.observacao && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          {d.observacao}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {gps && (
          <a
            href={`https://maps.google.com/?q=${gps[0]},${gps[1]}`}
            target="_blank" rel="noreferrer"
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
          >
            <LocateFixed className="w-3.5 h-3.5" /> GPS do entregador
          </a>
        )}
        {d.pedidos?.endereco && (
          <a
            href={mapsLink(d.pedidos.endereco)}
            target="_blank" rel="noreferrer"
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 border border-border transition-colors"
          >
            <Navigation className="w-3.5 h-3.5" /> Destino
          </a>
        )}
        {d.entregadores?.telefone && (
          <a
            href={`https://wa.me/${d.entregadores.telefone.replace(/\D/g, "")}`}
            target="_blank" rel="noreferrer"
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> Entregador
          </a>
        )}
        {telCliente && (
          <a
            href={`https://wa.me/${telCliente.replace(/\D/g, "")}`}
            target="_blank" rel="noreferrer"
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 border border-border transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> Cliente
          </a>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, valor, destaque }: {
  icon: React.ReactNode; label: string; valor: string; destaque?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={cn("text-xl font-bold leading-none", destaque ?? "text-foreground")}>{valor}</p>
    </div>
  );
}

function AbaAoVivo({ despachos }: { despachos: DespachoFull[] }) {
  const ativos = despachos.filter(estaAtivo);
  const naRua = ativos.filter((d) => d.saiu_em);
  const aguardando = ativos.filter((d) => !d.saiu_em);
  const atrasadas = naRua.filter((d) => (minutosDesde(d.saiu_em) ?? 0) > SLA_MINUTOS);

  const hoje = new Date().toDateString();
  const entreguesHoje = despachos.filter(
    (d) => d.entregue_em && new Date(d.entregue_em).toDateString() === hoje
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi icon={<Truck className="w-3.5 h-3.5" />} label="Na rua" valor={String(naRua.length)} />
        <Kpi icon={<Clock className="w-3.5 h-3.5" />} label="Aguardando saída" valor={String(aguardando.length)} />
        <Kpi
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label={`Atrasadas (>${SLA_MINUTOS}min)`}
          valor={String(atrasadas.length)}
          destaque={atrasadas.length ? "text-red-600" : undefined}
        />
        <Kpi
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          label="Entregues hoje"
          valor={String(entreguesHoje.length)}
          destaque="text-green-600"
        />
      </div>

      <MapaAoVivo despachos={ativos} />

      {ativos.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma entrega em andamento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...ativos]
            .sort((a, b) => {
              const ma = minutosDesde(a.saiu_em ?? a.enviado_em) ?? 0;
              const mb = minutosDesde(b.saiu_em ?? b.enviado_em) ?? 0;
              return mb - ma; // mais antigas primeiro
            })
            .map((d) => <CardAoVivo key={d.id} d={d} />)}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Equipe (controle dos entregadores) ──────────────────────────────────

function PinInput({ pin, setPin, pinRefs }: {
  pin: string[];
  setPin: (p: string[]) => void;
  pinRefs: React.RefObject<HTMLInputElement>[];
}) {
  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...pin]; next[index] = digit; setPin(next);
    if (digit && index < 3) pinRefs[index + 1].current?.focus();
  }
  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !pin[index] && index > 0) pinRefs[index - 1].current?.focus();
  }
  return (
    <div className="flex gap-3 justify-center">
      {pin.map((digit, i) => (
        <input key={i} ref={pinRefs[i]} type="number" inputMode="numeric" min={0} max={9}
          value={digit} onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      ))}
    </div>
  );
}

/** Métricas agregadas de um entregador, calculadas a partir dos despachos. */
function metricasDe(entregadorId: string, despachos: DespachoFull[]) {
  const meus = despachos.filter((d) => d.entregador_id === entregadorId);
  const entregues = meus.filter((d) => d.entregue_em);
  const hoje = new Date().toDateString();
  const entreguesHoje = entregues.filter((d) => new Date(d.entregue_em!).toDateString() === hoje);
  const ativos = meus.filter(estaAtivo);

  const tempos = entregues
    .map((d) => minutosEntre(d.saiu_em, d.entregue_em))
    .filter((t): t is number => t != null && t >= 0);
  const tempoMedio = tempos.length ? tempos.reduce((s, t) => s + t, 0) / tempos.length : null;

  const recebido = entregues.reduce((s, d) => s + totalRecebido(d.pagamento_recebido), 0);

  return { total: entregues.length, entreguesHoje: entreguesHoje.length, emAndamento: ativos.length, tempoMedio, recebido };
}

function AbaEquipe({ entregadores, despachos }: {
  entregadores: EntregadorRow[];
  despachos: DespachoFull[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pinAberto, setPinAberto] = useState<EntregadorRow | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTel, setNovoTel] = useState("");
  const [novoPin, setNovoPin] = useState(["", "", "", ""]);

  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const novoPinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  function abrirPin(e: EntregadorRow) {
    setPinAberto(e);
    setPin(["", "", "", ""]);
    setTimeout(() => pinRefs[0].current?.focus(), 100);
  }

  async function salvarLogin() {
    if (!pinAberto) return;
    const pinStr = pin.join("");
    if (pinStr.length < 4) {
      toast({ title: "PIN incompleto", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const email = `${pinAberto.telefone.replace(/\D/g, "")}@farmaciavital.internal`;
      const res = await fetch("/api/create-entregador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: pinToPassword(pinStr),
          ...(pinAberto.user_id ? { userId: pinAberto.user_id } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.msg ?? result.error ?? "Erro na API");
      if (!pinAberto.user_id) {
        if (!result.id) throw new Error("user_id não retornado.");
        const { error } = await externalSupabase
          .from("entregadores").update({ user_id: result.id }).eq("id", pinAberto.id);
        if (error) throw new Error(error.message);
      }
      toast({ title: pinAberto.user_id ? `PIN redefinido para ${pinAberto.nome}` : `Login criado para ${pinAberto.nome}` });
      qc.invalidateQueries({ queryKey: ["monitor-entregadores"] });
      setPinAberto(null);
    } catch (err: unknown) {
      toast({
        title: "Erro ao salvar login",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function cadastrar() {
    if (!novoNome.trim() || !novoTel.trim()) {
      toast({ title: "Nome e telefone são obrigatórios", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const tel = novoTel.replace(/\D/g, "");
      const { data: inserted, error } = await externalSupabase
        .from("entregadores")
        .insert({ nome: novoNome.trim(), telefone: tel, ativo: true })
        .select()
        .single();
      if (error) throw new Error(error.message);

      const pinStr = novoPin.join("");
      if (pinStr.length === 4 && inserted) {
        const res = await fetch("/api/create-entregador", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `${tel}@farmaciavital.internal`,
            password: pinToPassword(pinStr),
          }),
        });
        const result = await res.json();
        if (res.ok && result.id) {
          await externalSupabase.from("entregadores").update({ user_id: result.id }).eq("id", inserted.id);
        }
      }

      toast({ title: `${novoNome} cadastrado` });
      qc.invalidateQueries({ queryKey: ["monitor-entregadores"] });
      setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]);
      setNovoAberto(false);
    } catch (err: unknown) {
      toast({
        title: "Erro ao cadastrar",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function alternarAtivo(e: EntregadorRow) {
    const { error } = await externalSupabase
      .from("entregadores").update({ ativo: !e.ativo }).eq("id", e.id);
    if (error) {
      toast({ title: "Erro ao alterar status", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${e.nome} ${e.ativo ? "desativado" : "ativado"}` });
    qc.invalidateQueries({ queryKey: ["monitor-entregadores"] });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setNovoNome(""); setNovoTel(""); setNovoPin(["", "", "", ""]); setNovoAberto(true); }}>
          <UserPlus className="w-4 h-4 mr-1.5" /> Novo entregador
        </Button>
      </div>

      {entregadores.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-10">Nenhum entregador cadastrado.</p>
      )}

      {entregadores.map((e) => {
        const m = metricasDe(e.id, despachos);
        return (
          <div key={e.id} className={cn("bg-card border rounded-xl p-4", e.ativo ? "border-border" : "border-border opacity-60")}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                m.emAndamento ? "bg-violet-600 text-white" : "bg-primary/10 text-primary"
              )}>
                {iniciais(e.nome)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground truncate">{e.nome}</p>
                  {m.emAndamento > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      {m.emAndamento} na rua
                    </span>
                  )}
                  {!e.ativo && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      Inativo
                    </span>
                  )}
                  {e.user_id
                    ? <span className="text-[10px] text-green-600 font-medium">● Login ativo</span>
                    : <span className="text-[10px] text-amber-600 font-medium">● Sem login</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{e.telefone}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Entregues</p>
                <p className="text-sm font-bold">{m.total}</p>
              </div>
              <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Hoje</p>
                <p className="text-sm font-bold">{m.entreguesHoje}</p>
              </div>
              <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Tempo médio</p>
                <p className="text-sm font-bold">{duracaoCurta(m.tempoMedio)}</p>
              </div>
              <div className="bg-secondary/60 rounded-lg px-2.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">Recebido</p>
                <p className={cn("text-sm", moneyClass(m.recebido))}>{brl(m.recebido)}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => abrirPin(e)}>
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                {e.user_id ? "Redefinir PIN" : "Criar login"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => alternarAtivo(e)}>
                <Power className="w-3.5 h-3.5 mr-1.5" />
                {e.ativo ? "Desativar" : "Ativar"}
              </Button>
              <a
                href={`https://wa.me/${e.telefone.replace(/\D/g, "")}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors"
              >
                <Phone className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
              </a>
            </div>
          </div>
        );
      })}

      {/* Modal PIN */}
      <Dialog open={!!pinAberto} onOpenChange={(v) => { if (!v) setPinAberto(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinAberto?.user_id ? "Redefinir PIN" : "Criar login"}</DialogTitle>
          </DialogHeader>
          {pinAberto && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold">{pinAberto.nome}</p>
                <p className="text-xs text-muted-foreground">{pinAberto.telefone}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {pinAberto.user_id ? "Novo PIN de 4 dígitos" : "Defina um PIN de 4 dígitos"}
                </p>
                <PinInput pin={pin} setPin={setPin} pinRefs={pinRefs} />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setPinAberto(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={salvarLogin} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal novo entregador */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo entregador</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ent-nome">Nome</Label>
              <Input id="ent-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ent-tel">Telefone (WhatsApp)</Label>
              <Input id="ent-tel" value={novoTel} onChange={(e) => setNovoTel(e.target.value)} placeholder="5521900000000" type="tel" />
            </div>
            <div className="space-y-1.5">
              <Label>PIN de acesso (opcional)</Label>
              <PinInput pin={novoPin} setPin={setNovoPin} pinRefs={novoPinRefs} />
              <p className="text-xs text-muted-foreground text-center">Pode ser definido depois</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setNovoAberto(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={cadastrar} disabled={loading || !novoNome.trim() || !novoTel.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cadastrar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Aba: Histórico ───────────────────────────────────────────────────────────

const PERIODOS = [
  { key: "hoje", label: "Hoje", dias: 0 },
  { key: "7d", label: "7 dias", dias: 7 },
  { key: "30d", label: "30 dias", dias: 30 },
  { key: "tudo", label: "Tudo", dias: null },
] as const;

function AbaHistorico({ despachos, entregadores }: {
  despachos: DespachoFull[];
  entregadores: EntregadorRow[];
}) {
  const [periodo, setPeriodo] = useState<typeof PERIODOS[number]["key"]>("7d");
  const [filtroEntregador, setFiltroEntregador] = useState<string>("todos");
  const [busca, setBusca] = useState("");

  const finalizados = useMemo(() => {
    const cfg = PERIODOS.find((p) => p.key === periodo)!;
    let limite: number | null = null;
    if (cfg.dias === 0) {
      const d = new Date(); d.setHours(0, 0, 0, 0); limite = d.getTime();
    } else if (cfg.dias != null) {
      limite = Date.now() - cfg.dias * 86400000;
    }

    return despachos
      .filter((d) => d.entregue_em || d.pedidos?.status === "cancelado")
      .filter((d) => {
        if (limite == null) return true;
        const ref = d.entregue_em ?? d.enviado_em;
        return new Date(ref).getTime() >= limite;
      })
      .filter((d) => filtroEntregador === "todos" || d.entregador_id === filtroEntregador)
      .filter((d) => {
        if (!busca.trim()) return true;
        const alvo = [
          d.entregadores?.nome,
          d.pedidos?.clientes?.nome,
          d.pedidos?.clientes?.telefone,
          d.pedidos?.endereco,
        ].filter(Boolean).join(" ").toLowerCase();
        return alvo.includes(busca.trim().toLowerCase());
      })
      .sort((a, b) => {
        const ta = new Date(a.entregue_em ?? a.enviado_em).getTime();
        const tb = new Date(b.entregue_em ?? b.enviado_em).getTime();
        return tb - ta;
      });
  }, [despachos, periodo, filtroEntregador, busca]);

  const entregues = finalizados.filter((d) => d.entregue_em);
  const cancelados = finalizados.filter((d) => !d.entregue_em && d.pedidos?.status === "cancelado");
  const faturado = entregues.reduce((s, d) => s + totalRecebido(d.pagamento_recebido), 0);
  const tempos = entregues
    .map((d) => minutosEntre(d.saiu_em, d.entregue_em))
    .filter((t): t is number => t != null && t >= 0);
  const tempoMedio = tempos.length ? tempos.reduce((s, t) => s + t, 0) / tempos.length : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi icon={<CheckCircle className="w-3.5 h-3.5" />} label="Entregues" valor={String(entregues.length)} destaque="text-green-600" />
        <Kpi icon={<Package className="w-3.5 h-3.5" />} label="Cancelados" valor={String(cancelados.length)} destaque={cancelados.length ? "text-red-600" : undefined} />
        <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="Tempo médio" valor={duracaoCurta(tempoMedio)} />
        <Kpi icon={<DollarSign className="w-3.5 h-3.5" />} label="Recebido" valor={brl(faturado)} destaque={moneyClass(faturado)} />
      </div>

      {/* Filtros */}
      <div className="space-y-2">
        <div className="flex gap-1 flex-wrap">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                periodo === p.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filtroEntregador}
            onChange={(e) => setFiltroEntregador(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[150px]"
          >
            <option value="todos">Todos os entregadores</option>
            {entregadores.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Cliente, endereço, telefone..."
              className="h-9 pl-8"
            />
          </div>
        </div>
      </div>

      {finalizados.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma entrega no período selecionado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {finalizados.map((d) => {
            const cancelado = !d.entregue_em;
            const dur = minutosEntre(d.saiu_em, d.entregue_em);
            const recebido = totalRecebido(d.pagamento_recebido);
            return (
              <div
                key={d.id}
                className={cn(
                  "bg-card border rounded-xl px-4 py-3",
                  cancelado ? "border-red-200" : "border-border"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                    cancelado ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {iniciais(d.entregadores?.nome ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {d.pedidos?.clientes?.nome ?? d.pedidos?.clientes?.telefone ?? "—"}
                      </p>
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                        cancelado ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                      )}>
                        {cancelado ? "Cancelado" : "Entregue"}
                      </span>
                      {d.fotos?.length ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Camera className="w-3 h-3" /> {d.fotos.length}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {d.entregadores?.nome ?? "Sem entregador"}
                      {d.pedidos?.endereco ? ` · ${d.pedidos.endereco}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(d.entregue_em ?? d.enviado_em), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                      {dur != null ? ` · ${duracaoCurta(dur)} em rota` : ""}
                    </p>
                    {d.observacao && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1.5">
                        {d.observacao}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {recebido > 0 ? (
                      <>
                        <p className="text-[10px] text-muted-foreground">Recebido</p>
                        <p className={cn("text-sm", moneyClass(recebido))}>{brl(recebido)}</p>
                      </>
                    ) : d.pedidos?.valor_total != null ? (
                      <>
                        <p className="text-[10px] text-muted-foreground">Pedido</p>
                        <p className="text-sm font-semibold text-muted-foreground tabular">
                          {brl(d.pedidos.valor_total)}
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

type Aba = "ao_vivo" | "equipe" | "historico";

const ABAS: { key: Aba; label: string; icon: React.ReactNode }[] = [
  { key: "ao_vivo", label: "Ao vivo", icon: <Radio className="w-4 h-4" /> },
  { key: "equipe", label: "Equipe", icon: <Users className="w-4 h-4" /> },
  { key: "historico", label: "Histórico", icon: <History className="w-4 h-4" /> },
];

export default function Entregadores() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>("ao_vivo");
  const [aoVivo, setAoVivo] = useState(false);
  // Força re-render periódico para os contadores de "há X min" ficarem corretos
  const [, setTick] = useState(0);

  const { data: despachos, isLoading: loadingD } = useQuery({
    queryKey: ["monitor-despachos"],
    queryFn: fetchDespachos,
    refetchInterval: 30_000, // rede de segurança caso o websocket caia
  });

  const { data: entregadores, isLoading: loadingE } = useQuery({
    queryKey: ["monitor-entregadores"],
    queryFn: fetchEntregadores,
  });

  // Realtime: qualquer mudança em despacho_entrega/pedidos recarrega o monitor
  useEffect(() => {
    const canal = externalSupabase
      .channel("monitor-entregas")
      .on("postgres_changes", { event: "*", schema: "public", table: "despacho_entrega" }, () => {
        qc.invalidateQueries({ queryKey: ["monitor-despachos"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
        qc.invalidateQueries({ queryKey: ["monitor-despachos"] });
      })
      .subscribe((status) => setAoVivo(status === "SUBSCRIBED"));

    return () => { externalSupabase.removeChannel(canal); };
  }, [qc]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const lista = despachos ?? [];
  const equipe = entregadores ?? [];
  const naRua = lista.filter(estaAtivo).length;

  if (loadingD || loadingE) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-5 pb-3 border-b border-border bg-background">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold text-foreground">Entregadores</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {equipe.filter((e) => e.ativo).length} ativo(s) · {naRua} entrega(s) em andamento
            </p>
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border shrink-0",
              aoVivo
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-secondary text-muted-foreground border-border"
            )}
            title={aoVivo ? "Conectado ao Supabase Realtime" : "Sem websocket — atualizando a cada 30s"}
          >
            <span className={cn("w-2 h-2 rounded-full", aoVivo ? "bg-green-500 animate-pulse" : "bg-muted-foreground/50")} />
            {aoVivo ? "Ao vivo" : "30s"}
          </div>
        </div>

        <div className="flex gap-1">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                aba === a.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {a.icon}
              <span>{a.label}</span>
              {a.key === "ao_vivo" && naRua > 0 && (
                <span className={cn(
                  "ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  aba === a.key ? "bg-primary-foreground/20" : "bg-violet-600 text-white"
                )}>
                  {naRua}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {aba === "ao_vivo" && <AbaAoVivo despachos={lista} />}
          {aba === "equipe" && <AbaEquipe entregadores={equipe} despachos={lista} />}
          {aba === "historico" && <AbaHistorico despachos={lista} entregadores={equipe} />}
        </div>
      </div>
    </div>
  );
}
