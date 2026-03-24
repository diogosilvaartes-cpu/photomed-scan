import { useState, useRef } from "react";
import { Upload, Camera, Loader2, CheckCircle, Package, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";

// Comprime e redimensiona imagem para máx 1024px, JPEG quality 0.82 (~< 300KB)
async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  const MAX_PX = 1024;
  const QUALITY = 0.82;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = reject;
    img.src = url;
  });
}

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

export default function MedScanForm() {
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form, setForm] = useState<MedFormData>(EMPTY_FORM);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImage(url);
    setForm(EMPTY_FORM);
    setSaved(false);
  };

  const handleReadProduct = async () => {
    if (!imageFile) return;
    setReading(true);
    try {
      const { base64, mimeType } = await compressImage(imageFile);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64,
                  },
                },
                {
                  text: `Analise a embalagem deste medicamento e extraia as informações. Responda SOMENTE com um JSON válido, sem markdown, sem explicações, sem bloco de código, no formato:
{"name":"nome do medicamento","lab":"laboratório fabricante","dosage":"dosagem ex: 500mg","pharmaForm":"forma farmacêutica ex: Comprimido","quantity":"quantidade numérica de unidades na embalagem","batch":"número do lote ou vazio se não visível","expiry":"validade no formato YYYY-MM ou vazio se não visível"}`,
                },
              ],
            }],
            generationConfig: { temperature: 0.1 },
          }),
        }
      );

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      // Extrai JSON mesmo se vier com markdown ```json ... ```
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON não encontrado na resposta");
      const parsed = JSON.parse(jsonMatch[0]);

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
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[MedScan] Erro ao ler produto:", msg);
      toast({
        title: "Erro ao ler produto",
        description: msg.length < 120 ? msg : "Não foi possível identificar o medicamento. Preencha manualmente.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const handleSave = async () => {
    const required: (keyof MedFormData)[] = ["name", "lab", "dosage", "pharmaForm", "quantity"];
    const missing = required.filter((k) => !form[k].trim());
    if (missing.length) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha Nome, Laboratório, Dosagem, Forma farmacêutica e Quantidade.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const { error } = await externalSupabase.from("medications").insert({
      name: form.name,
      lab: form.lab,
      dosage: form.dosage,
      pharma_form: form.pharmaForm,
      quantity: Number(form.quantity),
      batch: form.batch || null,
      expiry: form.expiry || null,
    });
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
    toast({
      title: "Salvo no estoque!",
      description: `${form.name} adicionado com sucesso.`,
    });
  };

  const handleReset = () => {
    setImage(null);
    setImageFile(null);
    setForm(EMPTY_FORM);
    setSaved(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const handleField = (key: keyof MedFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setSaved(false);
  };

  const formFilled = Object.values(form).some((v) => v.trim() !== "");

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-start py-10 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="bg-medical p-2 rounded-xl">
          <Package className="w-6 h-6 text-medical-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-deep leading-tight">Cadastro por Foto</h1>
          <p className="text-sm text-slate-muted">Escaneie a embalagem e preencha automaticamente</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-[650px] bg-card rounded-2xl shadow-card border border-silver p-6 md:p-8 space-y-6">

        {/* Upload Zone */}
        <div>
          <Label className="text-label mb-2 block">Foto da embalagem</Label>
          {!image ? (
            <div className="w-full border-2 border-dashed border-silver rounded-xl py-10 flex flex-col items-center gap-4">
              <div className="bg-medical/10 p-4 rounded-full">
                <Camera className="w-8 h-8 text-medical" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-deep">Adicione uma foto da embalagem</p>
                <p className="text-sm text-slate-muted mt-1">JPG, PNG ou WEBP</p>
              </div>
              <div className="flex gap-3 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex items-center gap-2 bg-medical text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-medical/90 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  Tirar foto
                </button>
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="flex items-center gap-2 bg-white border border-silver text-slate-deep text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                  Enviar da galeria
                </button>
              </div>
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden border border-silver">
              <img src={image} alt="Embalagem do medicamento" className="w-full object-cover max-h-72" />
              <button
                type="button"
                onClick={handleReset}
                className="absolute top-3 right-3 bg-slate-deep/70 hover:bg-slate-deep text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                Trocar foto
              </button>
            </div>
          )}
          {/* Câmera: abre câmera no mobile */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageChange}
          />
          {/* Galeria: escolhe arquivo ou galeria no mobile */}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />
        </div>

        {/* Read Product Button */}
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
              Ler produto
            </>
          )}
        </Button>

        {/* Form */}
        {(formFilled || image) && (
          <div className="space-y-5 pt-2 border-t border-silver">
            <h2 className="text-base font-semibold text-slate-deep">Dados do medicamento</h2>

            {/* Nome — full width */}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-label">Nome do medicamento <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                placeholder="Ex: Dipirona Sódica"
                value={form.name}
                onChange={handleField("name")}
                className="input-med"
              />
            </div>

            {/* Lab + Dosagem — 2 cols */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="lab" className="text-label">Laboratório <span className="text-destructive">*</span></Label>
                <Input
                  id="lab"
                  placeholder="Ex: EMS Pharma"
                  value={form.lab}
                  onChange={handleField("lab")}
                  className="input-med"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dosage" className="text-label">Dosagem <span className="text-destructive">*</span></Label>
                <Input
                  id="dosage"
                  placeholder="Ex: 500mg"
                  value={form.dosage}
                  onChange={handleField("dosage")}
                  className="input-med"
                />
              </div>
            </div>

            {/* Forma farmacêutica + Quantidade — 2 cols */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="pharmaForm" className="text-label">Forma farmacêutica <span className="text-destructive">*</span></Label>
                <Input
                  id="pharmaForm"
                  placeholder="Ex: Comprimido"
                  value={form.pharmaForm}
                  onChange={handleField("pharmaForm")}
                  className="input-med"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantity" className="text-label">Quantidade <span className="text-destructive">*</span></Label>
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

            {/* Lote + Validade — 2 cols */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="batch" className="text-label">Lote</Label>
                <Input
                  id="batch"
                  placeholder="Ex: LT2024-08A"
                  value={form.batch}
                  onChange={handleField("batch")}
                  className="input-med"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiry" className="text-label">Validade</Label>
                <Input
                  id="expiry"
                  type="month"
                  value={form.expiry}
                  onChange={handleField("expiry")}
                  className="input-med"
                />
              </div>
            </div>

            {/* Save Button */}
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

      <p className="mt-6 text-xs text-slate-muted">MedScan · Gestão de Estoque Farmacêutico</p>
    </div>
  );
}
