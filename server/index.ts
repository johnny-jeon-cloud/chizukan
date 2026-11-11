import postgres from "npm:postgres@3.4.5";
import { handle } from "./handler.mjs";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 10 });
const ALLOW_GET = false;
Deno.serve((req: Request) => handle(req, { sql, allowGet: ALLOW_GET }));
