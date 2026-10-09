export interface Env {
  DB: D1Database;
  RAW: R2Bucket;

  // Plain variables, managed in the Cloudflare dashboard (kept on deploy via `keep_vars`).
  AUTH_URL: string;
  AVAILABILITY_URL: string;
  AUTH_USERNAME: string;

  // Secrets (`wrangler secret put`).
  AUTH_PASSWORD: string;
  DASHBOARD_PASSWORD: string;
}
