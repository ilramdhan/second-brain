import { describe, expect, it } from "vitest";

import {
  BLOCK_TYPES,
  linksOf,
  loadBlocks,
  newId,
  noteGraph,
  runQuery,
  shortcut,
  toMarkdown,
  type Block,
} from "@/lib/blocks";
import type { NoteSummary, Task } from "@/lib/data";

describe("shortcut", () => {
  it.each([
    ["# Title", "h1", "Title"],
    ["## Sub", "h2", "Sub"],
    ["### Small", "h3", "Small"],
    ["[] buy", "todo", "buy"],
    ["[ ] buy", "todo", "buy"],
    ["- [ ] buy", "todo", "buy"],
    ["- item", "bullet", "item"],
    ["* item", "bullet", "item"],
    ["1. first", "numbered", "first"],
    ["1) first", "numbered", "first"],
    ["> said", "quote", "said"],
    ["```", "code", ""],
    ["---", "divider", ""],
  ])("%s → %s", (input, type, text) => {
    expect(shortcut(input)).toEqual({ type, text });
  });

  it("recognises checked todos", () => {
    expect(shortcut("[x] done")).toEqual({ type: "todo", text: "done", checked: true });
    expect(shortcut("[X] done")).toEqual({ type: "todo", text: "done", checked: true });
  });

  // toMarkdown exports checked todos as "- [x] t"; they must re-import as todos, not bullets.
  it("recognises '- [x]' and '* [x]' checked todos", () => {
    expect(shortcut("- [x] done")).toEqual({ type: "todo", text: "done", checked: true });
    expect(shortcut("* [X] done")).toEqual({ type: "todo", text: "done", checked: true });
    expect(shortcut("* [ ] open")).toEqual({ type: "todo", text: "open" });
  });

  it("returns null for plain text", () => {
    expect(shortcut("hello")).toBeNull();
    expect(shortcut("#hashtag")).toBeNull();
  });
});

describe("newId / BLOCK_TYPES", () => {
  it("generates short ids that REF_RE accepts", () => {
    const id = newId();
    expect(id).toMatch(/^[a-z0-9]{1,8}$/);
    expect(newId()).not.toBe(id);
  });
  it("lists every block type once", () => {
    const ids = BLOCK_TYPES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("query");
  });
});

describe("loadBlocks", () => {
  it("returns one empty paragraph for an empty note", () => {
    const out = loadBlocks({ blocks: [] as never, content: "" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "p", text: "" });
  });

  it("parses legacy markdown content, keeping ^block ids and special blocks", () => {
    const content = [
      "# Heading ^abcdef12",
      "[x] done",
      "",
      "{{query TABLE a FROM #x}}",
      "{{embed ((zzzzzz99))}}",
      "plain",
    ].join("\n");
    const out = loadBlocks({ blocks: null as never, content });
    expect(out.map((b) => b.type)).toEqual(["h1", "todo", "query", "embed", "p"]);
    expect(out[0]).toEqual({ id: "abcdef12", type: "h1", text: "Heading" });
    expect(out[1]).toMatchObject({ checked: true, text: "done" });
    expect(out[2]!.text).toBe("TABLE a FROM #x");
    expect(out[3]!.text).toBe("zzzzzz99");
  });

  it("re-parses stored paragraphs (shortcuts typed into p blocks) but keeps their ids", () => {
    const stored: Block[] = [
      { id: "p1", type: "p", text: "## Later heading" },
      { id: "t1", type: "todo", text: "keep", checked: false },
    ];
    expect(loadBlocks({ blocks: stored as never, content: "" })).toEqual([
      { id: "p1", type: "h2", text: "Later heading" },
      { id: "t1", type: "todo", text: "keep", checked: false },
    ]);
  });
});

describe("toMarkdown", () => {
  it("renders every block type and restarts numbering after other blocks", () => {
    const blocks: Block[] = [
      { id: "1", type: "h1", text: "A" },
      { id: "2", type: "h2", text: "B" },
      { id: "3", type: "h3", text: "C" },
      { id: "4", type: "todo", text: "t", checked: true },
      { id: "5", type: "todo", text: "u" },
      { id: "6", type: "bullet", text: "b" },
      { id: "7", type: "numbered", text: "one" },
      { id: "8", type: "numbered", text: "two" },
      { id: "9", type: "quote", text: "q" },
      { id: "10", type: "numbered", text: "again" },
      { id: "11", type: "code", text: "x = 1" },
      { id: "12", type: "divider", text: "" },
      { id: "13", type: "query", text: "LIST FROM #a" },
      { id: "14", type: "embed", text: "abcdef12" },
      { id: "15", type: "p", text: "end" },
    ];
    expect(toMarkdown(blocks)).toBe(
      [
        "# A",
        "## B",
        "### C",
        "- [x] t",
        "- [ ] u",
        "- b",
        "1. one",
        "2. two",
        "> q",
        "1. again",
        "```\nx = 1\n```",
        "---",
        "{{query LIST FROM #a}}",
        "{{embed ((abcdef12))}}",
        "end",
      ].join("\n"),
    );
  });

  it("round-trips through loadBlocks for line-based types", () => {
    const md = "# T\n- [ ] a\n- b\n> c\n{{query LIST FROM tasks}}";
    expect(toMarkdown(loadBlocks({ blocks: [] as never, content: md }))).toBe(md);
  });
});

describe("linksOf", () => {
  it("handles aliases, whitespace and invalid refs", () => {
    const { titles, refs } = linksOf([
      { id: "a", type: "p", text: "[[A|alias]] [[ b ]] ((short)) ((abcdef1234)) ((ABCDEF12))" },
    ]);
    expect([...titles]).toEqual(["a", "b"]);
    expect([...refs]).toEqual(["abcdef1234"]);
  });
});

describe("noteGraph", () => {
  it("builds de-duplicated edges from wikilinks and block refs, skipping self-links", () => {
    const notes = [
      {
        id: "n1",
        title: "Alpha",
        blocks: [{ id: "aaaaaa01", type: "p", text: "[[Beta]] [[beta]] [[Alpha]] [[Missing]]" }],
        content: "",
      },
      {
        id: "n2",
        title: " Beta ",
        blocks: [{ id: "bbbbbb01", type: "p", text: "x" }],
        content: "",
      },
      {
        id: "n3",
        title: "Gamma",
        blocks: [
          { id: "cccccc01", type: "p", text: "see ((bbbbbb01)) ((cccccc01))" },
          { id: "cccccc02", type: "embed", text: "aaaaaa01" },
        ],
        content: "",
      },
    ] as never;
    expect(noteGraph(notes)).toEqual([
      { source: "n1", target: "n2" },
      { source: "n3", target: "n2" },
      { source: "n3", target: "n1" },
    ]);
  });
});

describe("runQuery", () => {
  const note = (id: string, extra: Partial<NoteSummary> & Record<string, unknown>) =>
    ({
      id,
      title: id,
      tags: [],
      project_id: null,
      properties: {},
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      ...extra,
    }) as unknown as NoteSummary;
  const notes = [
    note("Dune", { tags: ["buku"], properties: { rating: 5, genre: "fiksi" } }),
    note("Sapiens", { tags: ["Buku"], properties: { rating: 4, genre: "sejarah" } }),
    note("Foundation", { tags: ["buku", "scifi"], properties: { rating: 10, genre: "fiksi" } }),
    note("Plan", { tags: ["kerja"], project_id: "p1", properties: {} }),
  ];
  const tasks = [
    { id: "t1", title: "Write", status: "todo", priority: "high", parent_id: null, tags: ["x"] },
    { id: "t2", title: "Ship", status: "done", priority: "low", parent_id: null, tags: [] },
    { id: "t3", title: "Sub", status: "todo", priority: "low", parent_id: "t1", tags: [] },
  ] as unknown as Task[];
  const projects = [{ id: "p1", name: "Proyek Satu" }];
  const run = (q: string) => runQuery(q, notes, tasks, projects);
  const titles = (q: string) => run(q).rows.map((r) => r.title);

  it("returns a format error for unparseable queries", () => {
    const r = run("SELECT * FROM notes");
    expect(r.error).toMatch(/^Format:/);
    expect(r.rows).toEqual([]);
  });

  it("rejects unknown WHERE syntax", () => {
    expect(run("LIST FROM #buku WHERE rating ~ 3").error).toBe("Syarat WHERE tidak dikenali");
  });

  it("TABLE filters by tag (case-insensitive), compares numerically and sorts", () => {
    const r = run("TABLE rating, genre FROM #buku WHERE rating > 4 SORT rating DESC");
    expect(r).toMatchObject({ mode: "table", source: "notes", columns: ["rating", "genre"] });
    expect(r.rows).toEqual([
      { id: "Foundation", title: "Foundation", values: { rating: 10, genre: "fiksi" } },
      { id: "Dune", title: "Dune", values: { rating: 5, genre: "fiksi" } },
    ]);
  });

  it("supports AND, !=, contains, >=, <=, = and LIMIT", () => {
    expect(titles("LIST FROM #buku WHERE genre = fiksi AND rating >= 5 SORT title")).toEqual([
      "Dune",
      "Foundation",
    ]);
    expect(titles("LIST FROM #buku WHERE genre != fiksi")).toEqual(["Sapiens"]);
    expect(titles('LIST FROM #buku WHERE genre contains "sej"')).toEqual(["Sapiens"]);
    expect(titles("LIST FROM #buku WHERE rating <= 4")).toEqual(["Sapiens"]);
    expect(titles("LIST FROM #buku WHERE rating < 5")).toEqual(["Sapiens"]);
    expect(titles("LIST FROM #buku SORT rating ASC LIMIT 2")).toEqual(["Sapiens", "Dune"]);
    expect(titles("LIST FROM #buku WHERE genre > fiksi")).toEqual(["Sapiens"]);
  });

  it("matches array fields (tags) with = and !=", () => {
    expect(titles("LIST WHERE tags = #scifi")).toEqual(["Foundation"]);
    expect(titles("LIST FROM #buku WHERE tags != scifi")).toEqual(["Dune", "Sapiens"]);
  });

  it("supports FROM a project name, OR sources and unknown sources", () => {
    expect(titles('LIST FROM "Proyek Satu"')).toEqual(["Plan"]);
    expect(titles("LIST FROM #kerja OR #scifi")).toEqual(["Foundation", "Plan"]);
    expect(titles('LIST FROM "Nope"')).toEqual([]);
  });

  it("queries top-level tasks with aliases for created/updated/due", () => {
    const r = run("TABLE status, due FROM tasks WHERE status != done");
    expect(r.source).toBe("tasks");
    expect(r.rows.map((x) => x.id)).toEqual(["t1"]);
    expect(titles("LIST FROM tugas SORT title")).toEqual(["Ship", "Write"]);
  });

  it("sorts by the created alias as strings", () => {
    const out = runQuery(
      "LIST SORT created DESC",
      [note("a", { created_at: "2026-01-01" }), note("b", { created_at: "2026-02-01" })],
      [],
      [],
    );
    expect(out.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
