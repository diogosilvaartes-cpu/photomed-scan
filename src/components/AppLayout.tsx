import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Package, Users, Truck, LogOut, Menu, X, FlaskConical, ClipboardList, LayoutDashboard, Bike } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  adminOnly?: boolean;
  entregadorOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: <LayoutDashboard className="w-5 h-5" />, label: "Dashboard", adminOnly: true },
  { to: "/scan", icon: <FlaskConical className="w-5 h-5" />, label: "Scan", adminOnly: true },
  { to: "/estoque", icon: <Package className="w-5 h-5" />, label: "Estoque", adminOnly: true },
  { to: "/pedidos", icon: <ClipboardList className="w-5 h-5" />, label: "Pedidos", adminOnly: true },
  { to: "/clientes", icon: <Users className="w-5 h-5" />, label: "Clientes" },
  { to: "/entregadores", icon: <Bike className="w-5 h-5" />, label: "Entregadores", adminOnly: true },
  { to: "/entregas", icon: <Truck className="w-5 h-5" />, label: "Entregas", entregadorOnly: true },
];

function NavItems({ onClick }: { onClick?: () => void }) {
  const { role } = useAuth();
  const items = NAV_ITEMS.filter((i) => {
    if (i.adminOnly && role !== "admin") return false;
    if (i.entregadorOnly && role === "admin") return false;
    return true;
  });

  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onClick}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            )
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function UserInfo() {
  const { user, role, entregadorNome, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const displayName = role === "entregador" ? entregadorNome : "Admin";
  const displayEmail = user?.email ?? "";

  return (
    <div className="px-4 py-3 border-t border-sidebar-border">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-sidebar-accent-foreground truncate">{displayName}</p>
          <p className="text-xs text-sidebar-foreground/70 truncate">{displayEmail}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSignOut}
          title="Sair"
          className="text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Marca */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <BrandMark variant="onDark" className="w-10 h-10" />
        <div className="min-w-0">
          <p className="font-display text-base font-extrabold text-sidebar-accent-foreground leading-tight truncate">
            Farmácia Vital
          </p>
          <p className="text-xs text-sidebar-foreground/80 truncate">Painel Operacional</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-sidebar-foreground hover:text-sidebar-accent-foreground"
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navegação */}
      <div className="flex-1 py-4 overflow-y-auto">
        <NavItems onClick={onClose} />
      </div>

      {/* Usuário */}
      <UserInfo />
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-64 shrink-0">
        <SidebarContent />
      </aside>

      {/* Overlay mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-foreground/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-50 w-72 h-full shadow-card-hover">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar mobile */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <BrandMark className="w-7 h-7" />
            <span className="font-display text-sm font-extrabold text-foreground">Farmácia Vital</span>
          </div>
        </header>

        {/* Página */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
