import { describe, it, expect, vi, afterEach } from 'vitest';
import { leadTelegramText, notifyLeadTelegram } from './leadTelegram';

const base = { label: 'Home report', address: '7 Elm Ave, Toronto', name: 'Jane Doe', email: 'jane@example.com' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('leadTelegramText', () => {
  it('heads with the lead type and the home, and skips empty fields', () => {
    expect(leadTelegramText(base)).toBe(
      '🔔 New lead: Home report\n7 Elm Ave, Toronto\n\nName: Jane Doe\nEmail: jane@example.com',
    );
  });

  it('adds the qualifiers, the message and the listing link when present', () => {
    const t = leadTelegramText({ ...base, listingKey: 'W14185390', phone: '416-555-0100', timeline: 'Ready to make an offer', hasAgent: 'Yes', message: 'fair?' });
    expect(t).toContain('Phone: 416-555-0100');
    expect(t).toContain('Buying timeline: Ready to make an offer');
    expect(t).toContain('Working with an agent: Yes');
    expect(t).toContain('Message: fair?');
    expect(t).toMatch(/\/properties\/W14185390$/);
  });
});

describe('notifyLeadTelegram', () => {
  it('is a no-op without the env', async () => {
    vi.stubEnv('LEAD_TELEGRAM_BOT_TOKEN', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await notifyLeadTelegram(base)).toEqual({ sent: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('posts plain text to the configured chat', async () => {
    vi.stubEnv('LEAD_TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('LEAD_TELEGRAM_CHAT_ID', '42');
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', f);
    expect(await notifyLeadTelegram(base)).toEqual({ sent: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottok/sendMessage');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBeUndefined();
  });

  it('never throws when Telegram fails', async () => {
    vi.stubEnv('LEAD_TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('LEAD_TELEGRAM_CHAT_ID', '42');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await notifyLeadTelegram(base)).toEqual({ sent: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await notifyLeadTelegram(base)).toEqual({ sent: false });
  });
});
