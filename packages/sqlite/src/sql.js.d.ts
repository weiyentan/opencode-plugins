/**
 * Type declarations for sql.js (https://github.com/sql-js/sql.js)
 * 
 * sql.js v1.14.1 doesn't ship bundled TypeScript declarations.
 * This file provides the types needed by the SQLite plugin.
 */

declare module "sql.js" {
  interface SqlJsStatic {
    Database: typeof Database;
    Statement: typeof Statement;
  }

  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    exec(sql: string): QueryExecResult[];
    run(sql: string): Statement;
    prepare(sql: string): Statement;
    close(): void;
  }

  class Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(params?: object): Record<string, unknown>;
    free(): boolean;
    reset(): void;
  }

  interface SqlJsStaticConfig {
    locateFile?: (file: string) => string;
  }

  export { Database, Statement, SqlJsStatic, SqlJsStaticConfig, QueryExecResult };
  export default function initSqlJs(config?: SqlJsStaticConfig): Promise<SqlJsStatic>;
}
