import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Zoom simples de uma imagem — clique fora ou no X fecha. */
export default function ImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string | null;
  alt?: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open && !!src} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-fit p-2 bg-transparent border-none shadow-none">
        <DialogTitle className="sr-only">{alt || "Imagem ampliada"}</DialogTitle>
        {src && (
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-[85vh] max-w-full rounded-xl object-contain mx-auto"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
