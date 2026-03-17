import { useState, useRef } from "react";
import { Upload, Camera, Loader2, CheckCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
    if (!image) return;
    setReading(true);
    // Simulated AI fill — replace with real call later
    await new Promise((r) => setTimeout(r, 2000));
    setForm({
      name: "Dipirona Sódica",
      lab: "EMS Pharma",
      dosage: "500mg",
      pharmaForm: "Comprimido",
      quantity: "20",
      batch: "LT2024-08A",
      expiry: "2026-08",
    });
    setReading(false);
    toast({
      title: "Produto identificado",
      description: "Verifique os dados e edite se necessário.",
    });
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
    await new Promise((r) => setTimeout(r, 1200));
    setSaving(false);
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
    if (inputRef.current) inputRef.current.value = "";
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

      <p className="mt-6 text-xs text-slate-muted">MedScan · Gestão de Estoque Farmacêutico</p>
    </div>
  );
}
