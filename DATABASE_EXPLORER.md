# Database Explorer Options for Rentifier

Your local D1 database is a **shared** SQLite file located at:
```
.wrangler/v3/d1/miniflare-D1DatabaseObject/*.sqlite
```

**Note:** All workers (collector, processor, notify) share this single database file thanks to the `--persist-to .wrangler` flag.

## Option 1: DataGrip (Recommended) ✅

**Yes, DataGrip works perfectly!**

### Setup Instructions:

1. **Open DataGrip**
2. **New Data Source** → **SQLite**
3. **File**: Browse to the SQLite file:
   ```
   /Users/orila/Development/rentifier/.wrangler/v3/d1/miniflare-D1DatabaseObject/*.sqlite
   ```
4. **Test Connection** → **OK**

### Features:
- ✅ Browse all tables (listings, listings_raw, sources, users, filters, etc.)
- ✅ Run SQL queries with autocomplete
- ✅ View data in grid format
- ✅ Export data (CSV, JSON, etc.)
- ✅ ER diagrams

**Note:** The SQLite file path contains a hash that may change if you reset the database. If DataGrip can't connect, check the latest file path with:
```bash
find .wrangler -name "*.sqlite"
```

## Option 2: VS Code SQLite Extension

1. Install: **SQLite Viewer** or **SQLite** extension
2. Right-click the `.sqlite` file in VS Code explorer
3. Select "Open Database"

## Option 3: Wrangler CLI (Built-in)

Query the database directly from the terminal:

```bash
# Simple query
pnpm db:query:local "SELECT * FROM sources"

# Count listings
pnpm db:query:local "SELECT COUNT(*) as count FROM listings"

# View recent listings
pnpm db:query:local "SELECT id, title, price, city FROM listings ORDER BY created_at DESC LIMIT 10"

# Check users and filters
pnpm db:query:local "SELECT * FROM users"
pnpm db:query:local "SELECT * FROM filters"
```

## Option 4: TablePlus (macOS)

Free tier works great for SQLite:
1. Download: https://tableplus.com
2. **New Connection** → **SQLite**
3. **Database Path**: Browse to the `.sqlite` file
4. Connect

## Option 5: DB Browser for SQLite (Free & Open Source)

1. Download: https://sqlitebrowser.org
2. **Open Database** → Select the `.sqlite` file
3. Browse data, execute SQL, view schema

## Production Database Access

For the **production** D1 database on Cloudflare:

### Via Cloudflare Dashboard:
1. Go to https://dash.cloudflare.com
2. **Storage & Databases** → **D1**
3. Select `rentifier` database
4. Use the built-in SQL console

### Via Wrangler CLI:
```bash
# Query production database
pnpm --filter @rentifier/collector exec wrangler d1 execute rentifier --remote --command "SELECT COUNT(*) FROM listings"

# Interactive SQL console
pnpm --filter @rentifier/collector exec wrangler d1 execute rentifier --remote
```

**Note:** Production D1 doesn't expose a direct SQLite file connection. Use Cloudflare Dashboard or Wrangler CLI only.

## Recommended Workflow

**For Local Development:**
- **DataGrip** or **TablePlus** for visual exploration and complex queries
- **Wrangler CLI** (`pnpm db:query:local`) for quick checks during development

**For Production:**
- **Cloudflare Dashboard** for occasional queries and monitoring
- **Wrangler CLI** for scripted access or migrations
