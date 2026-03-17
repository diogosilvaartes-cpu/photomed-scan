import { useNavigate } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import MedScanForm from "@/components/MedScanForm";

export default function Index() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-start py-10 px-4">
      <div className="w-full max-w-[650px] flex justify-end mb-2">
        <Button variant="outline" onClick={() => navigate("/estoque")}>
          <PackageSearch className="w-4 h-4 mr-2" />
          Ver estoque
        </Button>
      </div>
      <MedScanForm />
    </div>
  );
}
