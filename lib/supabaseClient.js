import { createClient } from '@supabase/supabase-js';

const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
const configuredAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

const hasValidUrl =
  /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?\/?$/.test(configuredUrl) &&
  !configuredUrl.toLowerCase().includes('placeholder');

export const isSupabaseConfigured = hasValidUrl;

export const supabase = createClient(
  hasValidUrl ? configuredUrl : 'https://placeholder.supabase.co',
  configuredAnonKey && !configuredAnonKey.toLowerCase().includes('placeholder')
    ? configuredAnonKey
    : 'placeholder-key',
);