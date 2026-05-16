#!/usr/bin/env python3
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("SUPABASE_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
    or os.getenv("VITE_SUPABASE_KEY")
)

print("SUPABASE_URL:", SUPABASE_URL)
print("Key present:", "yes" if SUPABASE_KEY else "no")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing Supabase configuration. Check backend/.env for keys.")
    sys.exit(2)

try:
    from supabase import create_client
except Exception as e:
    print("Failed to import supabase client:", e)
    sys.exit(3)

try:
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table('bookmarks').select('*').limit(1).execute()
    data = getattr(resp, 'data', None)
    err = getattr(resp, 'error', None)
    if err:
        print("Supabase returned an error:", err)
        sys.exit(4)
    print("Supabase query OK. Sample response:", data)
    sys.exit(0)
except Exception as e:
    print("Supabase connection/test failed:", e)
    sys.exit(4)
