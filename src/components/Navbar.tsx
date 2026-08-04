import { NavLink } from "react-router-dom";
import { ScanLine, PackageSearch, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Scan", icon: ScanLine, end: true },
  { to: "/estoque", label: "Estoque", icon: PackageSearch, end: false },
  { to: "/pedidos", label: "Pedidos", icon: ClipboardList, end: false },
];

export default function Navbar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-40 h-14 bg-white border-b border-border shadow-sm flex items-center px-4 gap-1">
      <span className="text-status-ink-novo font-bold text-lg mr-4 tracking-tight select-none">
        Med<span className="text-foreground">Scan</span>
      </span>
      <div className="flex items-center gap-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
