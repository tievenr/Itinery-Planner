// Supabase connection. The anon key is public by design: the tables are locked and
// only reachable through code-checked functions (see supabase/functions.sql).
// Never put the service_role / secret key here.

export const SUPABASE_URL = 'https://cqqoogdheinztomkytgp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxcW9vZ2RoZWluenRvbWt5dGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNDE4MDEsImV4cCI6MjEwNzcxNzgwMX0.TtoEMm_hykLQVLWcH0w24BbVNAPvoSvsQgN2GaOP-64';
