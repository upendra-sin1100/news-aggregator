// Lazy-initialize Supabase client using Vite env variables.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_KEY || ''

let _client = null
let _initializing = null

export async function getSupabaseClient() {
    if (_client) return _client
    if (!SUPABASE_URL || !SUPABASE_KEY) return null
    if (_initializing) return _initializing
    _initializing = initialize()
    return _initializing
}

async function initialize() {
    try {
        const mod = await import('@supabase/supabase-js')
        const { createClient } = mod
        _client = createClient(SUPABASE_URL, SUPABASE_KEY)
        return _client
    } catch (e) {
        console.warn('Supabase client not available (package missing):', e)
        return null
    }
}

export default getSupabaseClient
