import { describe, expect, it } from "vitest";

import { draftToForm, emptyNoteForm, formToInsert, type NoteDraft } from "./note-prefill";

const draft: NoteDraft = {
  title: "Riset QRIS",
  blocks: [
    { id: "a1b2c3d4", type: "h2", text: "Pembanding" },
    { id: "b1b2c3d4", type: "bullet", text: "Midtrans" },
    { id: "c1b2c3d4", type: "todo", text: "tanya finance", checked: false },
  ],
  status: "draft",
  project_id: null,
  tags: ["riset"],
  pinned: true,
  properties: { rating: 5, penulis: "James" },
};

describe("note prefill mapping", () => {
  it("maps a draft to editable form fields (content as markdown)", () => {
    const form = draftToForm(draft, "p-current");
    expect(form).toEqual({
      title: "Riset QRIS",
      content: "## Pembanding\n- Midtrans\n- [ ] tanya finance",
      status: "draft",
      projectId: "p-current",
      tags: ["riset"],
      pinned: true,
      properties: [
        ["rating", "5"],
        ["penulis", "James"],
      ],
    });
    expect(draftToForm({ ...draft, project_id: "p-x" }, "p-current").projectId).toBe("p-x");
  });

  it("maps the reviewed form back to a note insert with blocks as source of truth", () => {
    const form = { ...draftToForm(draft), content: "## Pembanding\n- Xendit" };
    const insert = formToInsert(form);
    expect(insert).toMatchObject({
      title: "Riset QRIS",
      content: "## Pembanding\n- Xendit",
      status: "draft",
      tags: ["riset"],
      pinned: true,
      properties: { rating: 5, penulis: "James" },
    });
    expect((insert.blocks as { type: string }[]).map((b) => b.type)).toEqual(["h2", "bullet"]);
  });

  it("defaults an empty title and starts empty", () => {
    expect(formToInsert(emptyNoteForm("p1"))).toMatchObject({
      title: "Tanpa judul",
      project_id: "p1",
      status: "idea",
    });
  });
});
