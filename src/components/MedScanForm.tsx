import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Camera, Loader2, CheckCircle, ScanLine, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { BrowserMultiFormatReader } from "@zxing/browser";

type Mode = "barcode" | "photo";

interface MedFormData {
  name: string;
  lab: string;
  dosage: string;
  pharmaForm: string;
  quantity: string;
  batch: string;
  expiry: string;
}

const EMPTY_FORM: MedFormData = {
  name: "",
  lab: "",
  dosage: "",
  pharmaForm: "",
  quantity: "",
  batch: "",
  expiry: "",
};

interface Props {
  onSaved?: () => void;
}

function parseGS1(raw: string) {
  const GS = "\x1d";
  let str = raw.replace(/\((\d+)\)/g, "$1");
  const result: { gtin?: string; lot?: string; expiry?: string } = {};
  let i = 0;
  while (i < str.length) {
    const ai2 = str.slice(i, i + 2);
    if (ai2 === "01") {
      i += 2;
      result.gtin = str.slice(i, i + 14);
      i += 14;
    } else if (ai2 === "17") {
      i += 2;
      const raw6 = str.slice(i, i + 6);
      i += 6;
      if (raw6.length === 6) {
        const yy = raw6.slice(0, 2);
        const mm = raw6.slice(2, 4);
        const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
        result.expiry = `${year}-${mm}`;
      }
    } else if (ai2 === "10") {
      i += 2;
      const end = str.indexOf(GS, i);
      result.lot = end >= 0 ? str.slice(i, end) : str.slice(i);
      i = end >= 0 ? end + 1 : str.length;
    } else {
      i++;
    }
  }
  return result;
}

async function lookupByGTIN(gtin: string): Promise<Partial<MedFormData>> {
  const ean = gtin.replace(/^0/, "");
  try {
    const res = await fetch(
      `https://brasilapi.com.br/api/anvisa/medicamentos/v1/${ean}`
    );
    if (!res.ok) return {};
    const d = await res.json();
    return {
      name: d.nome_produto ?? d.produto ?? "",
      lab: d.empresa_detentora_registro ?? d.empresa ?? "",
      dosage: d.concentracao ?? "",
      pharmaForm: d.forma_farmaceutica ?? "",
    };
  } catch {
    return {};
  }
}

export default function MedScanForm({ onSaved }: Props) {
  const [mode, setMode] = useState<Mode>("photo");
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form, setForm] = useState<MedFormData>(EMPTY_FORM);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const { toast } = useToast();

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      BrowserMultiFormatReader.releaseAllStreams();
      readerRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (!videoRef.current) return;
    setScanning(true);
    setScanStatus("Aponte para o código de barras ou DataMatrix...");
    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result, err) => {
          if (err && (err as any).name === "NotFoundException") return;
          if (!result) return;
          stopScanner();
          const raw = result.getText();
          setScanStatus("Código lido! Buscando informações...");
          const gs1 = parseGS1(raw);
          let filled: Partial<MedFormData> = {};
          if (gs1.gtin) filled = await lookupByGTIN(gs1.gtin);
          setForm((prev) => ({
            ...prev,
            ...filled,
            batch: gs1.lot ?? prev.batch,
            expiry: gs1.expiry ?? prev.expiry,
          }));
          setScanStatus("");
          toast({
            title: "Código lido com sucesso!",
            description: gs1.gtin
              ? "Verifique os dados e complete se necessário."
              : "Preencha o nome manualmente.",
          });
        }
      );
    } catch {
      setScanning(false);
      setScanStatus("");
      toast({
        title: "Erro ao acessar câmera",
        description: "Verifique as permissões de câmera do navegador.",
        variant: "destructive",
      });
    }
  }, [stopScanner, toast]);

  useEffect(() => () => stopScanner(), [stopScanner]);
  useEffect(() => {
    if (mode !== "barcode") stopScanner();
  }, [mode, stopScanner]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImage(URL.createObjectURL(file));
    setForm(EMPTY_FORM);
    setSaved(false);
  };

  const handleReadProduct = async () => {
    if (!imageFile) return;
    setReading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
      });
      const mimeType = imageFile.type || "image/jpeg";
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mimeType }),
      });
      if (!response.ok) throw new Error(`Erro ${response.status}`);
      const parsed = await response.json();
      setForm({
        name: parsed.name ?? "",
        lab: parsed.lab ?? "",
        dosage: parsed.dosage ?? "",
        pharmaForm: parsed.pharmaForm ?? "",
        quantity: parsed.quantity ?? "",
        batch: parsed.batch ?? "",
        expiry: parsed.expiry ?? "",
      });
      toast({
        title: "Produto identificado",
        description: "Verifique os dados e edite se necessário.",
      });
    } catch (err) {
      toast({
        title: "Erro ao ler produto",
        description:
          err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const handleSave = async () => {
    const required: (keyof MedFormData)[] = [
      "name",
      "lab",
      "dosage",
      "pharmaForm",
      "quantity",
    ];
    const missing = required.filter((k) => !String(form[k] ?? "").trim());
    if (missing.length) {
      toast({
        title: "Campos obrigatórios",
        description:
          "Preencha Nome, Laboratório, Dosagem, Forma farmacêutica e Quantidade.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);

    let imagem_url: string | null = null;
    if (imageFile) {
      const ext = imageFile.name.split(".").pop() ?? "jpg";
      const path = `${Date.now()}_${form.name.replace(/\s+/g, "_")}.${ext}`;
      const { error: uploadError } = await externalSupabase.storage
        .from("medicamentos")
        .upload(path, imageFile, { upsert: true });
      if (!uploadError) {
        const { data: urlData } = externalSupabase.storage
          .from("medicamentos")
          .getPublicUrl(path);
        imagem_url = urlData.publicUrl;
      }
    }

    const { data: existing } = await externalSupabase
      .from("estoque")
      .select("id, quantidade")
      .eq("nome", form.name)
      .eq("dosagem", form.dosage)
      .eq("laboratorio", form.lab)
      .maybeSingle();

    let error;
    let updated = false;

    if (existing) {
      const novaQtd = (existing.quantidade ?? 0) + Number(form.quantity);
      ({ error } = await externalSupabase
        .from("estoque")
        .update({
          quantidade: novaQtd,
          lote: form.batch || null,
          validade: form.expiry || null,
          ...(imagem_url ? { imagem_url } : {}),
        })
        .eq("id", existing.id));
      updated = true;
    } else {
      ({ error } = await externalSupabase.from("estoque").insert({
        nome: form.name,
        laboratorio: form.lab,
        dosagem: form.dosage,
        forma: form.pharmaForm,
        quantidade: Number(form.quantity),
        lote: form.batch || null,
        validade: form.expiry || null,
        imagem_url,
      }));
    }

    setSaving(false);
    if (error) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setSaved(true);
    onSaved?.();
    toast({
      title: updated ? "Estoque atualizado!" : "Salvo no estoque!",
      description: updated
        ? `Quantidade de ${form.name} somada ao estoque existente.`
        : `${form.name} adicionado com sucesso.`,
    });
  };

  const handleReset = () => {
    setImage(null);
    setImageFile(null);
    setForm(EMPTY_FORM);
    setSaved(false);
    setScanStatus("");
    stopScanner();
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleField =
    (key: keyof MedFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
      setSaved(false);
    };

  const formFilled = Object.values(form).some((v) => v.trim() !== "");

  return (
    <div className="w-full max-w-[650px] bg-card rounded-2xl shadow-card border border-silver p-6 md:p-8 space-y-6">

      {/* Mode Selector */}
      <div className="flex rounded-xl border border-silver overflow-hidden">
        <button
          type="button"
          onClick={() => setMode("barcode")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            mode === "barcode"
              ? "bg-medical text-white"
              : "bg-white text-slate-500 hover:bg-medical/5"
          }`}
        >
          <ScanLine className="w-4 h-4" />
          Código de barras
        </button>
        <button
          type="button"
          onClick={() => setMode("photo")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            mode === "photo"
              ? "bg-medical text-white"
              : "bg-white text-slate-500 hover:bg-medical/5"
          }`}
        >
          <Camera className="w-4 h-4" />
          Foto / Câmera
        </button>
      </div>

      {/* BARCODE MODE */}
      {mode === "barcode" && (
        <div className="space-y-4">
          <div className="relative rounded-xl overflow-hidden border border-silver bg-black aspect-video flex items-center justify-center">
            <video ref={videoRef} className="w-full h-full object-cover" />
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
                <ScanLine className="w-10 h-10 text-white opacity-70" />
                <p className="text-white text-sm opacity-70">Câmera inativa</p>
              </div>
            )}
            {scanning && (
              <div className="absolute bottom-0 inset-x-0 bg-black/50 py-2 px-4">
                <div className="flex items-center gap-2 text-white text-xs">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {scanStatus || "Escaneando..."}
                </div>
              </div>
            )}
          </div>

          {!scanning ? (
            <Button
              variant="medical"
              size="lg"
              className="w-full"
              onClick={startScanner}
            >
              <ScanLine className="w-5 h-5 mr-2" />
              Iniciar leitura de código
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={stopScanner}
            >
              <X className="w-5 h-5 mr-2" />
              Cancelar
            </Button>
          )}

          {formFilled && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Dados preenchidos pelo código. Confira antes de salvar.</span>
            </div>
          )}
        </div>
      )}

      {/* PHOTO MODE */}
      {mode === "photo" && (
        <div className="space-y-4">
          <div>
            <Label className="text-label mb-2 block">Foto da embalagem</Label>
            {!image ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full border-2 border-dashed border-silver rounded-xl py-12 flex flex-col items-center gap-3 hover:border-medical hover:bg-medical/5 transition-colors cursor-pointer group"
              >
                <div className="bg-medical/10 p-4 rounded-full group-hover:bg-medical/20 transition-colors">
                  <Camera className="w-8 h-8 text-medical" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-deep">
                    Toque para enviar uma foto
                  </p>
                  <p className="text-sm text-slate-muted mt-1">
                    JPG, PNG ou WEBP · Máx. 10MB
                  </p>
                </div>
                <div className="flex items-center gap-2 text-medical text-sm font-medium">
                  <Upload className="w-4 h-4" />
                  Escolher arquivo
                </div>
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-silver">
                <img
                  src={image}
                  alt="Embalagem do medicamento"
                  className="w-full object-cover max-h-72"
                />
                <button
                  type="button"
                  onClick={handleReset}
                  className="absolute top-3 right-3 bg-slate-deep/70 hover:bg-slate-deep text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Trocar foto
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          <Button
            variant="medical"
            size="lg"
            className="w-full"
            disabled={!image || reading}
            onClick={handleReadProduct}
          >
            {reading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Lendo produto...
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 mr-2" />
                Ler produto com IA
              </>
            )}
          </Button>
        </div>
      )}

      {/* Shared Form */}
      {(formFilled || (mode === "photo" && image)) && (
        <div className="space-y-5 pt-2 border-t border-silver">
          <h2 className="text-base font-semibold text-slate-deep">
            Dados do medicamento
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-label">
              Nome do medicamento <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Ex: Dipirona Sódica"
              value={form.name}
              onChange={handleField("name")}
              className="input-med"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="lab" className="text-label">
                Laboratório <span className="text-destructive">*</span>
              </Label>
              <Input
                id="lab"
                placeholder="Ex: EMS Pharma"
                value={form.lab}
                onChange={handleField("lab")}
                className="input-med"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dosage" className="text-label">
                Dosagem <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dosage"
                placeholder="Ex: 500mg"
                value={form.dosage}
                onChange={handleField("dosage")}
                className="input-med"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pharmaForm" className="text-label">
                Forma farmacêutica <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pharmaForm"
                placeholder="Ex: Comprimido"
                value={form.pharmaForm}
                onChange={handleField("pharmaForm")}
                className="input-med"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity" className="text-label">
                Quantidade <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quantity"
                type="number"
                placeholder="Ex: 20"
                value={form.quantity}
                onChange={handleField("quantity")}
                className="input-med"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="batch" className="text-label">
                Lote
              </Label>
              <Input
                id="batch"
                placeholder="Ex: LT2024-08A"
                value={form.batch}
                onChange={handleField("batch")}
                className="input-med"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiry" className="text-label">
                Validade
              </Label>
              <Input
                id="expiry"
                type="month"
                value={form.expiry}
                onChange={handleField("expiry")}
                className="input-med"
              />
            </div>
          </div>

          {mode === "barcode" && (
            <div className="space-y-1.5">
              <Label className="text-label">
                Foto da embalagem{" "}
                <span className="text-slate-muted text-xs font-normal">
                  (opcional)
                </span>
              </Label>
              {!image ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="w-full border border-dashed border-silver rounded-xl py-4 flex items-center justify-center gap-2 hover:border-medical hover:bg-medical/5 transition-colors text-sm text-slate-muted"
                >
                  <Upload className="w-4 h-4" />
                  Adicionar foto
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-silver">
                  <img
                    src={image}
                    alt="Embalagem"
                    className="w-full object-cover max-h-40"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImage(null);
                      setImageFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="absolute top-2 right-2 bg-slate-deep/70 hover:bg-slate-deep text-white text-xs px-2 py-1 rounded-lg"
                  >
                    Remover
                  </button>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleImageChange}
              />
            </div>
          )}

          <Button
            variant="success"
            size="lg"
            className="w-full mt-2"
            onClick={handleSave}
            disabled={saving || saved}
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Salvando...
              </>
            ) : saved ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Salvo no estoque!
              </>
            ) : (
              "Salvar no estoque"
            )}
          </Button>

          {saved && (
            <button
              type="button"
              onClick={handleReset}
              className="w-full text-sm text-medical font-medium hover:underline text-center"
            >
              + Cadastrar outro medicamento
            </button>
          )}
        </div>
      )}
    </div>
  );
}
