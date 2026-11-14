/* PROVE IT — production client config.
   ONLY the publishable (anon) key belongs here — it is safe in client code
   because RLS + the server-side RPC functions gate everything it can touch.
   The service_role / secret key NEVER goes in this file or the site repo. */
window.PROVE_IT_CONFIG = {
  supabaseUrl: "https://bxybcrnzgrlsjipklkve.supabase.co",
  supabaseAnonKey: "sb_publishable_b0g8ZAkVTlC2sa92HBS9GQ_YoWPyZ38"
};
