import { useState, useRef } from "react";
import { Upload, Camera, Loader2, CheckCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { externalSupabase } from "@/integrations/supabase/external-client";

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

export default function MedScanForm({ onSaved }: Props) {
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form, setForm] = useState<MedFormData>(EMPTY_FORM);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      // Convert image to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
      });

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? "AIzaSyBqKkqoHhZxhLgztkFPx81nRphN_mKc65A";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType: imageFile.type || "image/jpeg",
                    data: base64,
                  },
                },
                {
                  text: `Analise a embalagem deste medicamento e extraia as informações. Responda SOMENTE com um JSON válido, sem markdown, sem explicações, no formato:
{
  "name": "nome do medicamento",
  "lab": "laboratório fabricante",
  "dosage": "dosagem ex: 500mg",
  "pharmaForm": "forma farmacêutica ex: Comprimido",
  "quantity": "quantidade numérica de unidades na embalagem",
  "batch": "número do lote ou vazio se não visível",
  "expiry": "validade no formato YYYY-MM ou vazio se não visível"
}`,
                },
              ],
            }],
            generationConfig: { temperature: 0.1 },
          }),
        }
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(`Gemini ${response.status}: ${JSON.stringify(errBody)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      // Remove markdown code fences if Gemini wraps the response
      const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(clean);

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
      console.error("Gemini error:", err);
      toast({
        title: "Erro ao ler produto",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const handleSave = async () => {
    const required: (keyof MedFormData)[] = ["name", "lab", "dosage", "pharmaForm", "quantity"];
    const missing = required.filter((k) => !String(form[k] ?? "").trim());
    if (missing.length) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha Nome, Laboratório, Dosagem, Forma farmacêutica e Quantidade.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);

    // Upload image to storage
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

    // Check if same product already exists (nome + dosagem + laboratorio)
    const { data: existing } = await externalSupabase
      .from("medicamentos")
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
        .from("medicamentos")
        .update({
          quantidade: novaQtd,
          lote: form.batch || null,
          validade: form.expiry || null,
          ...(imagem_url ? { imagem_url } : {}),
        })
        .eq("id", existing.id));
      updated = true;
    } else {
      ({ error } = await externalSupabase.from("medicamentos").insert({
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
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleField = (key: keyof MedFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setSaved(false);
  };

  const formFilled = Object.values(form).some((v) => v.trim() !== "");

  return (
    <div className="w-full max-w-[650px] bg-card rounded-2xl shadow-card border border-silver p-6 md:p-8 space-y-6">

        {/* Upload Zone */}
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
                <p className="font-semibold text-slate-deep">Toque para enviar uma foto</p>
                <p className="text-sm text-slate-muted mt-1">JPG, PNG ou WEBP · Máx. 10MB</p>
              </div>
              <div className="flex items-center gap-2 text-medical text-sm font-medium">
                <Upload className="w-4 h-4" />
                Escolher arquivo
              </div>
            </button>
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
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
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
  );
}
