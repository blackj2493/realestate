import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';

const ID = process.argv[2] || 'W13133990';
(async () => {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from('listings')
    .select('listing_key, city, media_urls, full_payload, synced_at')
    .eq('listing_key', ID)
    .maybeSingle();
  if (error) { console.error('ERR:', error.message); process.exit(1); }
  if (!data) { console.log('NOT FOUND in listings table'); process.exit(0); }
  const p = (data.full_payload || {}) as any;
  console.log('listing_key      :', data.listing_key);
  console.log('city             :', data.city);
  console.log('synced_at        :', data.synced_at);
  console.log('StandardStatus   :', p.StandardStatus);
  console.log('MlsStatus        :', p.MlsStatus);
  console.log('Status           :', p.Status);
  console.log('media_urls len   :', Array.isArray(data.media_urls) ? data.media_urls.length : '(not array)');
  console.log('media_urls[0]    :', Array.isArray(data.media_urls) && data.media_urls[0] || '(empty)');
  console.log('full_payload.media len :', Array.isArray(p.media) ? p.media.length : '(none)');
  console.log('full_payload.images len:', Array.isArray(p.images) ? p.images.length : '(none)');
  if (Array.isArray(p.media) && p.media.length > 0) {
    console.log('first media   :', JSON.stringify(p.media[0]).slice(0,300));
  }
  if (Array.isArray(p.images) && p.images.length > 0) {
    console.log('first image   :', JSON.stringify(p.images[0]).slice(0,300));
  }
  process.exit(0);
})();
