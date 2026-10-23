import { createClient } from '@supabase/supabase-js';

const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
const configuredAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

const isPlaceholder = (value) => /placeholder|your[-_ ]|example/i.test(value);
const hasValidUrl =
  /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?\/?$/.test(configuredUrl) &&
  !isPlaceholder(configuredUrl);

export const isSupabaseConfigured =
  hasValidUrl && Boolean(configuredAnonKey) && !isPlaceholder(configuredAnonKey);

export const supabase = createClient(
  hasValidUrl ? configuredUrl : 'https://placeholder.supabase.co',
  configuredAnonKey && !isPlaceholder(configuredAnonKey) ? configuredAnonKey : 'placeholder-key',
);