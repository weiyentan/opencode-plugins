# SQLite Plugin (`@weiyentan/opencode-plugin-sqlite`)

[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-sqlite)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-sqlite)
[![License](https://img.shields.io/npm/l/@weiyentan/opencode-plugin-sqlite)](https://github.com/weiyentan/opencode-plugins/blob/master/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/weiyentan/opencode-plugins/ci.yml?branch=master)](https://github.com/weiyentan/opencode-plugins/actions)

An [OpenCode](https://github.com/weiyentan/opencode) server plugin for read-only SQLite database queries. Exposes tools to explore database schema and execute read-only SQL queries within an OpenCode agent session.

## Prerequisites

- **Node.js** >= 20
- A SQLite database file (`.db`, `.sqlite`, or any SQLite-compatible file)

## Installation

```bash
npm install @weiyentan/opencode-plugin-sqlite
```

Register the plugin in your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    "@weiyentan/opencode-plugin-sqlite"
  ]
}
```

Configure the database path by setting the `OPENCODE_DB_PATH` environment variable:

```bash
export OPENCODE_DB_PATH=/path/to/your/database.db
```

If not set, the plugin defaults to `~/.local/share/opencode/opencode.db`.

## Quick Start

After installing and configuring, restart your OpenCode server. The following tools become available:

```
sqlite_tables  — List all tables in the database
sqlite_schema  — Inspect the schema of a specific table
sqlite_query   — Execute a read-only SQL query
```

### Example

```bash
# List all tables
> sqlite_tables
```

```bash
# Inspect a table schema
> sqlite_schema table: users
```

```bash
# Run a query
> sqlite_query sql: "SELECT * FROM users LIMIT 5"
```

## Available Tools

| Tool | Description | Args |
|------|-------------|------|
| `sqlite_tables` | List all tables in the connected database | *(none)* |
| `sqlite_schema` | Get column info for a specific table | `table` (string, required) |
| `sqlite_query` | Execute a read-only SQL query | `sql` (string, required) |

### sqlite_query — Read-Only Enforcement

The `sqlite_query` tool enforces strict read-only validation:
- Accepts: `SELECT`, `PRAGMA`, `EXPLAIN`, `WITH`
- Rejects: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`
- Multi-statement input is rejected (semicolons inside string literals are handled correctly)
- All validation happens before any database operation

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
