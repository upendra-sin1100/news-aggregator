import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load the backend .env (same approach as main.py)
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

# Read URL and key with fallbacks to Vite env var names used in the frontend/backend .env
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = (
	os.getenv("SUPABASE_KEY")
	or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
	or os.getenv("SUPABASE_ANON_KEY")
	or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
	or os.getenv("VITE_SUPABASE_KEY")
)

# Create the active database connection if configuration is present
if SUPABASE_URL and SUPABASE_KEY:
	supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
	supabase = None