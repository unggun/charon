import Database from "better-sqlite3";
import path from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var __charonDb: Database.Database | undefined;
}

function open() {
  const dbPath =
    process.env.CHARON_DB_PATH ??
    path.resolve(process.cwd(), "..", "charon.sqlite");
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export const db: Database.Database =
  global.__charonDb ?? (global.__charonDb = open());
