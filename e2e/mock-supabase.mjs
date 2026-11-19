// Banc d'essai local : imite le strict nécessaire de l'API Supabase (Auth,
// PostgREST, Realtime) au-dessus d'un vrai Postgres où la migration a été
// appliquée. Chaque requête s'exécute avec le rôle « authenticated » et
// l'identifiant de l'utilisateur, comme sur Supabase : la RLS et les
// fonctions serveur sont donc réellement appliquées.
//
// Ce n'est PAS Supabase : pas de confirmation d'e-mail, pas de signature JWT,
// et le temps réel diffuse un signal « quelque chose a changé » à tous les
// clients (le filtrage RLS du temps réel n'est pas reproduit).
//
// Usage : DATABASE_URL=postgres://… node e2e/mock-supabase.mjs  (port 54321)
import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT || 54321);
// Comme PostgREST : dates et horodatages renvoyés tels quels (texte).
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const users = new Map(); // email -> { id, email, password }
const tokens = new Map(); // token -> user

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session(user) {
  // Expiration lointaine : les tests avancent l'horloge du navigateur de plusieurs jours.
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  const access = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp })}.mock`;
  const refresh = randomUUID();
  tokens.set(access, user);
  tokens.set(`r:${refresh}`, user);
  return {
    access_token: access, token_type: "bearer", expires_in: 30 * 86400, expires_at: exp,
    refresh_token: refresh, user: publicUser(user),
  };
}
const publicUser = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
  app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString(),
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range",
};
function send(res, status, body) {
  res.writeHead(status, { ...CORS, "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const readBody = (req) =>
  new Promise((ok) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => ok(d ? JSON.parse(d) : null));
  });

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`identifiant refusé: ${s}`), { code: "PGRST100" });
  return `"${s}"`;
};

// Filtres PostgREST utilisés par l'app : eq, neq, gte, lte, gt, lt, in, is.
function where(params, values) {
  const out = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "columns", "on_conflict"].includes(k)) continue;
    const i = v.indexOf(".");
    const op = v.slice(0, i);
    const val = v.slice(i + 1);
    const col = `${ident(k)}::text`;
    const ops = { eq: "=", neq: "<>", gte: ">=", lte: "<=", gt: ">", lt: "<" };
    if (ops[op]) {
      values.push(val);
      out.push(`${col} ${ops[op]} $${values.length}`);
    } else if (op === "in") {
      values.push(val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")));
      out.push(`${col} = any($${values.length}::text[])`);
    } else if (op === "is") {
      out.push(`${ident(k)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
    } else throw Object.assign(new Error(`opérateur non géré: ${op}`), { code: "PGRST100" });
  }
  return out.length ? ` where ${out.join(" and ")}` : "";
}
const cols = (sel) => (!sel || sel === "*" ? "*" : sel.split(",").map((c) => ident(c.trim())).join(","));
function orderBy(o) {
  if (!o) return "";
  return " order by " + o.split(",").map((p) => {
    const [c, dir] = p.split(".");
    return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}`;
  }).join(",");
}

async function asUser(user, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${user ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(user ? { sub: user.id, role: "authenticated" } : { role: "anon" }),
    ]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function pgError(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "PGRST100" ? 400 : 400;
  send(res, status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

// --- Realtime (protocole Phoenix vsn 2.0.0, messages JSON en tableau) ------
const sockets = new Set();
function broadcastChange(table, type) {
  for (const ws of sockets) {
    for (const [topic, ch] of ws.channels) {
      const ids = ch.bindings.filter((b) => b.table === table || b.table === "*").map((b) => b.id);
      if (!ids.length) continue;
      ws.send(JSON.stringify([ch.joinRef, null, topic, "postgres_changes", {
        ids,
        data: { type, schema: "public", table, commit_timestamp: new Date().toISOString(), record: {}, old_record: {}, columns: [], errors: null },
      }]));
    }
  }
}
const RPC_TABLES = {
  claim_pickup: ["pickups"], request_relay: ["relay_requests"], respond_relay: ["relay_requests", "pickups"],
  cancel_relay: ["relay_requests"], save_pickups: ["pickups", "topics", "relay_requests"],
  claim_topic: ["topics"], propose_topic: ["topics"], respond_topic: ["topics"], cancel_topic_proposal: ["topics"],
  create_couple: ["couples", "couple_members"], mark_messages_read: ["profiles"], accept_invite: ["couple_members", "profiles"], create_invite: [],
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, "http://x");
  const auth = req.headers.authorization?.replace(/^Bearer /, "");
  const user = auth ? tokens.get(auth) : undefined;
  try {
    // ---- Auth ----
    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      const { email, password } = await readBody(req);
      if (users.has(email)) return send(res, 422, { code: "user_already_exists", msg: "User already registered", message: "User already registered" });
      const u = { id: randomUUID(), email, password };
      users.set(email, u);
      await pool.query("insert into auth.users (id, email) values ($1, $2)", [u.id, email]);
      return send(res, 200, session(u));
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = await readBody(req);
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const u = tokens.get(`r:${body.refresh_token}`);
        return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      }
      const u = users.get(body.email);
      if (!u || u.password !== body.password)
        return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(u));
    }
    if (url.pathname === "/auth/v1/user") {
      return user ? send(res, 200, publicUser(user)) : send(res, 401, { code: 401, msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") {
      if (auth) tokens.delete(auth);
      return send(res, 204);
    }

    // ---- RPC ----
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) {
      const args = (await readBody(req)) ?? {};
      const names = Object.keys(args);
      const values = names.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      const sql = `select public.${ident(rpc[1])}(${names.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as r`;
      const out = await asUser(user, (c) => c.query(sql, values));
      for (const t of RPC_TABLES[rpc[1]] ?? []) broadcastChange(t, "UPDATE");
      const r = out.rows[0].r;
      return send(res, 200, r === "" ? null : r);
    }

    // ---- Tables ----
    const tm = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!tm) return send(res, 404, { message: "not found" });
    const table = `public.${ident(tm[1])}`;
    const params = [...url.searchParams.entries()];
    const values = [];
    const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
    const prefer = req.headers.prefer || "";
    const returning = prefer.includes("return=representation") ? ` returning ${cols(url.searchParams.get("select"))}` : "";
    let sql;
    if (req.method === "GET") {
      sql = `select ${cols(url.searchParams.get("select"))} from ${table}${where(params, values)}${orderBy(url.searchParams.get("order"))}`;
    } else if (req.method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const keys = Object.keys(rows[0]).map(ident);
      values.push(JSON.stringify(rows));
      sql = `insert into ${table} (${keys.join(",")}) select ${keys.join(",")} from json_populate_recordset(null::${table}, $1)${returning}`;
    } else if (req.method === "PATCH") {
      const body = await readBody(req);
      const keys = Object.keys(body).map(ident);
      values.push(JSON.stringify(body));
      sql = `update ${table} set (${keys.join(",")}) = (select ${keys.join(",")} from json_populate_record(null::${table}, $1))${where(params, values)}${returning}`;
    } else if (req.method === "DELETE") {
      sql = `delete from ${table}${where(params, values)}${returning}`;
    } else return send(res, 405, {});
    const out = await asUser(user, (c) => c.query(sql, values));
    if (req.method !== "GET") broadcastChange(tm[1], req.method === "POST" ? "INSERT" : req.method === "PATCH" ? "UPDATE" : "DELETE");
    if (req.method !== "GET" && !returning) return send(res, req.method === "POST" ? 201 : 204);
    if (wantsObject) {
      if (out.rows.length !== 1)
        return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${out.rows.length} rows`, hint: null });
      return send(res, 200, out.rows[0]);
    }
    return send(res, req.method === "POST" ? 201 : 200, out.rows);
  } catch (e) {
    return pgError(res, e);
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.channels = new Map();
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const [joinRef, ref, topic, event, payload] = msg;
      const reply = (response) => ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]));
      if (event === "heartbeat") return reply({});
      if (event === "phx_join") {
        let n = 0;
        const bindings = (payload?.config?.postgres_changes ?? []).map((b) => ({ ...b, id: ++n + Math.floor(Math.random() * 1e6) }));
        ws.channels.set(topic, { joinRef, bindings });
        return reply({ postgres_changes: bindings.map(({ id, event: ev, schema, table }) => ({ id, event: ev, schema, table })) });
      }
      if (event === "phx_leave") {
        ws.channels.delete(topic);
        return reply({});
      }
      return reply({});
    });
  });
});

server.listen(PORT, () => console.log(`mock-supabase prêt sur http://localhost:${PORT}`));
