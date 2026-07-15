# Windows Verification Guide

## Prerequisites
- Windows 10/11 (64-bit)
- Node.js 20+ installed (any build toolchain NOT required)
- Git for Windows
- An OpenCode project directory

## Step 1: Install without native compilation

```powershell
# From your OpenCode project directory
npm install @weiyentan/opencode-plugin-sqlite
```

Expected result: install succeeds with no native compilation, no node-gyp, no MSVC errors.

## Step 2: Configure database path

Set OPENCODE_DB_PATH to point to a test SQLite database:

```powershell
$env:OPENCODE_DB_PATH = "C:\path\to\test.db"
```

## Step 3: Test the three tools

### sqlite_tables
Expected: lists all tables in the database as a markdown table.

### sqlite_schema
Expected: shows column info for a specific table.

### sqlite_query
Expected: executes SELECT queries and returns markdown-formatted results.

## Step 4: Edge case testing

| Scenario | How to test |
|----------|-------------|
| Missing database | Set OPENCODE_DB_PATH to a non-existent file |
| Corrupt database | Create a file with random bytes named .db |
| Invalid SQL | Pass a malformed query string |
| Read-only enforcement | Try INSERT/UPDATE/DELETE |

## Known Windows Caveats

- **Path separators**: OPENCODE_DB_PATH accepts both `\` and `/` on Windows (Node.js `path.resolve` handles this)
- **File locking**: Windows may retain file locks longer than Linux. If "database is locked" errors occur, wait and retry.
- **WASM loading**: sql.js loads its WASM binary synchronously from node_modules. If behind a corporate proxy, ensure local node_modules is accessible.
- **Antivirus**: Some antivirus software may scan the sql.js WASM binary on first load, causing a brief delay.

## Output comparison

If you have access to a system running the old better-sqlite3 version, compare outputs:

```powershell
# On old system (better-sqlite3)
npm install @weiyentan/opencode-plugin-sqlite@0.0.x
# Test tools

# On new system (sql.js)
npm install @weiyentan/opencode-plugin-sqlite@latest
# Test tools
# Outputs should be identical
```
