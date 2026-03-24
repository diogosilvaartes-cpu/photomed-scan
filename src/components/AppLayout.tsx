import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Package, Users, Truck, LogOut, Menu, X, FlaskConical, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: <FlaskConical className="w-5 h-5" />, label: "Scan", adminOnly: true },
  { to: "/estoque", icon: <Package className="w-5 h-5" />, label: "Estoque", adminOnly: true },
  { to: "/pedidos", icon: <ClipboardList className="w-5 h-5" />, label: "Pedidos", adminOnly: true },
  { to: "/clientes", icon: <Users className="w-5 h-5" />, label: "Clientes" },
  { to: "/entregas", icon: <Truck className="w-5 h-5" />, label: "Entregas" },
];

function NavItems({ onClick }: { onClick?: () => void }) {
  const { role } = useAuth();
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || role === "admin");

  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onClick}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
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
    <div className="px-4 py-3 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{displayEmail}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="bg-primary p-2 rounded-xl">
          <Package className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight">Farmácia Vital</p>
          <p className="text-xs text-muted-foreground">Painel Operacional</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <div className="flex-1 py-4 overflow-y-auto">
        <NavItems onClick={onClose} />
      </div>

      {/* User */}
      <UserInfo />
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-50 w-72 bg-card h-full shadow-xl">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <span className="text-sm font-bold text-foreground">Farmácia Vital</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
