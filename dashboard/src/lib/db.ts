import Database from "better-sqlite3";
import path from "node:path";

declare global {
  var __charonDb: Database.Database | undefined;
}

function open() {
  const dbPath =
    process.env.CHARON_DB_PATH ??
    path.resolve(process.cwd(), "..", "charon.sqlite");
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

// Lazy proxy: the Database connection is only opened on first property access,
// not at module evaluation time. This allows Next.js to import the module at
// build time without requiring the SQLite file to be present.
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    if (!global.__charonDb) {
      global.__charonDb = open();
    }
    const value = Reflect.get(global.__charonDb, prop, receiver);
    if (typeof value === "function") {
      return value.bind(global.__charonDb);
    }
    return value;
  },
});
