
CREATE TABLE public.medications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lab TEXT NOT NULL,
  dosage TEXT NOT NULL,
  pharma_form TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  batch TEXT,
  expiry TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert" ON public.medications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public select" ON public.medications
  FOR SELECT USING (true);

CREATE POLICY "Allow public update" ON public.medications
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete" ON public.medications
  FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_medications_updated_at
  BEFORE UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
