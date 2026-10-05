import { describe, expect, it } from "vitest";

import {
  EXCERPT_LENGTH,
  excerptOf,
  indexBlocks,
  noteIndexFields,
  withNoteIndex,
  type Block,
} from "@/lib/blocks";

const blocks: Block[] = [
  { id: "aaaaaa01", type: "p", text: "See [[ Project X | alias ]] and [[project x]]" },
  { id: "aaaaaa02", type: "bullet", text: "ref ((bbbbbb01)) and ((bad)) and [[Other]]" },
  { id: "aaaaaa03", type: "embed", text: "cccccc01" },
];

describe("noteIndexFields", () => {
  it("collects lower-cased, trimmed, de-duplicated link titles and block refs", () => {
    const f = noteIndexFields(blocks);
    expect(f.links.sort()).toEqual(["other", "project x"]);
    expect(f.refs.sort()).toEqual(["bbbbbb01", "cccccc01"]);
    expect(f.excerpt.startsWith("See [[ Project X")).toBe(true);
  });
});

describe("excerptOf", () => {
  it("keeps short content and cuts long content at EXCERPT_LENGTH code points", () => {
    expect(excerptOf("hi")).toBe("hi");
    const long = "😀".repeat(EXCERPT_LENGTH + 5);
    expect(Array.from(excerptOf(long))).toHaveLength(EXCERPT_LENGTH);
  });
});

describe("withNoteIndex", () => {
  it("leaves patches without blocks/content untouched", () => {
    const patch: { pinned: boolean; content?: string } = { pinned: true };
    expect(withNoteIndex(patch)).toBe(patch);
  });
  it("fills content, links, refs and excerpt from blocks", () => {
    const out = withNoteIndex({ title: "t", blocks });
    expect(out.content).toContain("{{embed ((cccccc01))}}");
    expect(out.links).toContain("project x");
    expect(out.refs).toContain("cccccc01");
    expect(out.excerpt).toBe(excerptOf(out.content!));
  });
  it("keeps the given content and parses legacy content without blocks", () => {
    const out = withNoteIndex({ content: "line [[A]]\n((dddddd01))" });
    expect(out.content).toBe("line [[A]]\n((dddddd01))");
    expect(out.links).toEqual(["a"]);
    expect(out.refs).toEqual(["dddddd01"]);
  });
});

describe("indexBlocks", () => {
  it("builds the index once per notes array", () => {
    const notes = [{ id: "n1", title: "N", blocks: blocks as never, content: "" }];
    const a = indexBlocks(notes);
    expect(indexBlocks(notes)).toBe(a);
    expect(a.get("aaaaaa02")?.note.id).toBe("n1");
    expect(indexBlocks([...notes])).not.toBe(a);
  });
});
