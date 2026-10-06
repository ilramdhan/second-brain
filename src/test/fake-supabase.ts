// In-memory stand-in for the slice of the supabase-js query builder used by the automation
// engines (select/insert/update + eq/neq/lt/lte/gte/is/not/in/order/limit/single/maybeSingle).
// Writes mutate `db`, every call is recorded in `calls`, so tests can assert on side effects.
type Row = Record<string, unknown>;
export type FakeCall = {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: string[];
};

export function fakeSupabase(db: Record<string, Row[]>) {
  const calls: FakeCall[] = [];
  let seq = 0;
  const from = (table: string) => {
    const call: FakeCall = { table, op: "select", filters: [] };
    calls.push(call);
    const preds: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    let returning = false;
    const add = (desc: string, p: (r: Row) => boolean) => {
      call.filters.push(desc);
      preds.push(p);
      return builder;
    };
    const cmp = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));
    const matching = () => {
      let rows = (db[table] ??= []).filter((r) => preds.every((p) => p(r)));
      if (order) {
        const { col, asc } = order;
        rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
      }
      return rows.slice(0, limit);
    };
    const run = () => {
      if (call.op === "insert") {
        const list = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
        const inserted = list.map((r) => ({
          id: `${table}-${++seq}`,
          created_at: new Date().toISOString(),
          ...r,
        }));
        (db[table] ??= []).push(...inserted);
        return { data: returning ? inserted : null, error: null };
      }
      if (call.op === "update") {
        const rows = matching();
        for (const r of rows) Object.assign(r, call.payload);
        return { data: returning ? rows : null, error: null };
      }
      // Copies, like a real HTTP response: later updates must not mutate rows already read.
      return { data: matching().map((r) => ({ ...r })), error: null };
    };
    const builder = {
      select: () => {
        if (call.op !== "select") returning = true;
        return builder;
      },
      insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), builder),
      update: (p: unknown) => ((call.op = "update"), (call.payload = p), builder),
      eq: (k: string, v: unknown) => add(`${k}=${v}`, (r) => r[k] === v),
      neq: (k: string, v: unknown) => add(`${k}!=${v}`, (r) => r[k] !== v),
      lt: (k: string, v: unknown) => add(`${k}<${v}`, (r) => r[k] != null && cmp(r[k], v) < 0),
      lte: (k: string, v: unknown) => add(`${k}<=${v}`, (r) => r[k] != null && cmp(r[k], v) <= 0),
      gte: (k: string, v: unknown) => add(`${k}>=${v}`, (r) => r[k] != null && cmp(r[k], v) >= 0),
      is: (k: string, v: null) => add(`${k} is ${v}`, (r) => (r[k] ?? null) === v),
      not: (k: string, _op: "is", v: null) => add(`${k} not ${v}`, (r) => (r[k] ?? null) !== v),
      in: (k: string, vs: unknown[]) => add(`${k} in`, (r) => vs.includes(r[k])),
      order: (col: string, o: { ascending?: boolean } = {}) => (
        (order = { col, asc: o.ascending !== false }),
        builder
      ),
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: async () => {
        const res = run();
        const rows = (res.data as Row[] | null) ?? [];
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        returning = true;
        const res = run();
        const rows = (res.data as Row[] | null) ?? [];
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "no rows" } };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
    };
    return builder;
  };
  return { client: { from } as never, calls, db };
}
