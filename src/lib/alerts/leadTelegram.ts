// New-lead push to the founder's Telegram (2026-11). The notification email can land in
// Gmail's Promotions tab and sit there for days; a Telegram message reaches the phone in
// seconds. Best-effort like the email: never throws, never blocks or fails lead capture.
//
// Env (Vercel): LEAD_TELEGRAM_BOT_TOKEN + LEAD_TELEGRAM_CHAT_ID. Unset → a no-op.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const TIMEOUT_MS = 5000;

export interface LeadTelegramInput {
  label: string;
  listingKey?: string;
  address?: string;
  name: string;
  email: string;
  phone?: string;
  preferredTime?: string;
  timeline?: string;
  hasAgent?: string;
  message?: string;
}

/** The message text. Plain text (no parse_mode), so lead input needs no escaping. */
export function leadTelegramText(l: LeadTelegramInput): string {
  const head = [`🔔 New lead: ${l.label}`, l.address || l.listingKey].filter(Boolean).join("\n");
  const body = [
    `Name: ${l.name}`,
    `Email: ${l.email}`,
    l.phone && `Phone: ${l.phone}`,
    l.preferredTime && `Preferred time: ${l.preferredTime}`,
    l.timeline && `Buying timeline: ${l.timeline}`,
    l.hasAgent && `Working with an agent: ${l.hasAgent}`,
    l.message && `Message: ${l.message}`,
    l.listingKey && `${SITE}/properties/${l.listingKey}`,
  ].filter(Boolean).join("\n");
  return `${head}\n\n${body}`;
}

export async function notifyLeadTelegram(l: LeadTelegramInput): Promise<{ sent: boolean }> {
  const token = process.env.LEAD_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.LEAD_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: leadTelegramText(l).slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[lead-telegram] sendMessage failed: ${res.status}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error("[lead-telegram] sendMessage error:", e instanceof Error ? e.message : e);
    return { sent: false };
  }
}
