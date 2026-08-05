import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Package, Users, Truck, LogOut, Search, ClipboardList, Bike } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/BrandMark";
import EntregaToggle from "@/components/EntregaToggle";
import FarmaciaToggle from "@/components/FarmaciaToggle";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  adminOnly?: boolean;
  entregadorOnly?: boolean;
}

/** Ordem de trabalho do balcão: a fila primeiro, o resto em volta dela. */
const NAV_ITEMS: NavItem[] = [
  { to: "/pedidos", icon: <ClipboardList className="w-5 h-5" />, label: "Pedidos" },
  { to: "/estoque", icon: <Package className="w-5 h-5" />, label: "Estoque", adminOnly: true },
  { to: "/clientes", icon: <Users className="w-5 h-5" />, label: "Clientes" },
  { to: "/entregadores", icon: <Bike className="w-5 h-5" />, label: "Entregadores", adminOnly: true },
  // Lupa, não frasco de laboratório: o SCAN é "procurar o que é este remédio",
  // e a lupa é o que o balcão reconhece de imediato na fileira de ícones.
  { to: "/scan", icon: <Search className="w-5 h-5" />, label: "Scan", adminOnly: true },
  { to: "/entregas", icon: <Truck className="w-5 h-5" />, label: "Entregas", entregadorOnly: true },
];

function useNavItems() {
  const { role } = useAuth();
  return NAV_ITEMS.filter((i) => {
    if (i.adminOnly && role !== "admin") return false;
    if (i.entregadorOnly && role === "admin") return false;
    return true;
  });
}

function NavItems({ onClick }: { onClick?: () => void }) {
  const items = useNavItems();

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

function SidebarContent() {
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
      </div>

      {/* Os dois estados que decidem o que a Ana responde, no topo e nesta ordem:
          "a farmácia atende?" vem antes de "a farmácia entrega?" — fechada, o
          toggle de entrega não muda nada para o cliente. */}
      <div className="pt-4">
        <FarmaciaToggle />
        <EntregaToggle />
      </div>

      {/* Navegação */}
      <div className="flex-1 pb-4 overflow-y-auto">
        <NavItems />
      </div>

      {/* Usuário */}
      <UserInfo />
    </div>
  );
}

/**
 * Menu mobile: ícones quadrados fixos no topo, sempre visíveis.
 * Substituiu a gaveta com hambúrguer — no balcão, trocar de seção é a ação
 * mais frequente e não compensa dois toques para cada troca.
 */
function MobileNav() {
  const items = useNavItems();

  return (
    <nav className="flex gap-2 px-3 pb-2.5 overflow-x-auto">
      {/* Primeiros da fileira, antes das seções: no mobile o balcão precisa
          alcançar sem rolar. Mesma ordem da sidebar. */}
      <FarmaciaToggle variant="mobile" />
      <EntregaToggle variant="mobile" />
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center justify-center gap-1 shrink-0 w-[68px] h-[62px] rounded-xl border text-[11px] font-semibold transition-colors",
              isActive
                ? "bg-primary text-primary-foreground border-transparent"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            )
          }
        >
          {item.icon}
          <span className="leading-none">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function MobileSignOut() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={async () => { await signOut(); navigate("/login"); }}
      title="Sair"
      className="ml-auto text-muted-foreground hover:text-foreground shrink-0"
    >
      <LogOut className="w-4 h-4" />
    </Button>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-64 shrink-0">
        <SidebarContent />
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar mobile: marca + menu de ícones quadrados */}
        <header className="md:hidden border-b border-border bg-card">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <BrandMark className="w-7 h-7" />
            <span className="font-display text-sm font-extrabold text-foreground">Farmácia Vital</span>
            <MobileSignOut />
          </div>
          <MobileNav />
        </header>

        {/* Página */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
