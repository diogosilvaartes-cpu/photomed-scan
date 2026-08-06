/**
 * Manda mensagem de texto pro cliente via `/api/notify-client` (Z-API).
 * Devolve se saiu ou não — quem chama decide como avisar a tela da falha
 * (a falha NUNCA pode ficar muda, foi bug que já escondeu instância morta
 * por semanas).
 */
export async function notifyWhatsApp(phone: string, message: string): Promise<boolean> {
  try {
    const r = await fetch("/api/notify-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.replace(/\D/g, ""), message }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
