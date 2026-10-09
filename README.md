# availabilities-monitor

Cloudflare Worker `reqs-availabilities`, který každých 10 minut (:05, :15, :25, …) stáhne snímek skladové dostupnosti z B2B API, uloží surovou odpověď do R2 a statistiky do D1. Přehled s grafy běží na <https://reqs-availabilities.jace.cz> a je chráněný heslem.

## Jak to funguje

1. **Cron** (`5-55/10 * * * *`) spustí `scheduled` handler.
2. `POST AUTH_URL` s `{username, password}` → `access_token` (přihlašuje se při každém běhu).
3. `GET AVAILABILITY_URL` s `Authorization: Bearer <token>` → pole `{productSizeCode, quantity, date}`.
4. Surová odpověď se uloží gzipem do R2 (`raw/YYYY/MM/DD/HHMM.json.gz`, UTC), a to i při chybě. Lifecycle pravidlo `expire-raw` ji po **14 dnech** smaže.
5. Do D1 (tabulka `runs`) se zapíše jeden řádek za běh:
   - HTTP status a doba odezvy přihlášení i dostupností, velikost odpovědi,
   - počet záznamů, unikátních SKU a záznamů s nulovým množstvím,
   - součet kusů celkem a „aktuálně skladem“ (záznamy s `date` ≤ čas stažení),
   - minimální a maximální `date` (původní hodnota i timestamp), počet různých a neplatných datumů,
   - histogram formátů datumů (`YYYY-MM-DDThh:mm:ss`, `…Z`, `…±hh:mm` atd.) s ukázkovou hodnotou.

   Datum bez časové zóny se pro porovnání bere jako UTC.

## Konfigurace

| Název | Typ | Popis |
|---|---|---|
| `AUTH_URL` | proměnná | endpoint pro přihlášení |
| `AVAILABILITY_URL` | proměnná | endpoint dostupností (případné parametry, např. `?includeFuture=true`, patří sem) |
| `AUTH_USERNAME` | proměnná | uživatel pro přihlášení |
| `AUTH_PASSWORD` | secret | heslo pro přihlášení |
| `DASHBOARD_PASSWORD` | secret | heslo pro zobrazení přehledu (jeho změna odhlásí všechny relace) |

Proměnné se spravují v Cloudflare (Workers → reqs-availabilities → Settings → Variables and Secrets), ne v repozitáři. Díky `keep_vars: true` je `wrangler deploy` nepřepíše.

```sh
npx wrangler secret put AUTH_PASSWORD --name reqs-availabilities
npx wrangler secret put DASHBOARD_PASSWORD --name reqs-availabilities
```

## Nasazení

```sh
npm install
npm run db:migrate   # D1 migrace (remote)
npm run deploy
```

Prostředky v Cloudflare: Worker `reqs-availabilities`, D1 `availabilities-monitor`, R2 `availabilities-monitor-raw`, custom doména `reqs-availabilities.jace.cz`.

## Lokální vývoj

```sh
cp .dev.vars.example .dev.vars   # doplnit hodnoty
npm run db:migrate:local
npm run dev
curl "http://localhost:8787/__scheduled?cron=5-55/10+*+*+*+*"   # ruční spuštění cronu
```

## HTTP endpointy

Kromě `/login` vyžaduje vše přihlášení (cookie `am_session`).

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/` | přehled |
| `GET` / `POST` | `/login` | přihlášení |
| `POST` | `/logout` | odhlášení |
| `GET` | `/api/runs?range=24h\|7d\|14d\|30d` | běhy a statistiky za období |
| `GET` | `/api/runs/:id/raw` | surová odpověď daného běhu (dokud ji nesmaže retence) |
| `POST` | `/api/run` | ruční běh mimo cron |
