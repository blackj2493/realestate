import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pyzgnivixhnwzfrdkiq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5emduaXZpbHhobnd6ZnJka2lxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEzODM3MSwiZXhwIjoyMDkyNzE0MzcxfQ.ziTZ7dNZbmsfuBzw6JtPXkQA4a-7cFMispCO-x-XKQ0'
);

const { count } = await supabase.from('listings').select('*', { count: 'exact', head: true });
console.log('Total listings:', count);

const { data } = await supabase.from('listings').select('id, listing_key').limit(3);
console.log('Sample records:', JSON.stringify(data, null, 2));