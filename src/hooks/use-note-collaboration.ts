import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import type { Block } from "@/lib/blocks";

type Peer = { id: string; label: string; x?: number; y?: number };
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/**
 * Realtime topic for a note's collaboration channel. Must stay in sync with
 * `public.note_collab_topic_note_id` (migration 0009), which only authorizes
 * `note-collab:<lowercase uuid>` on private channels.
 */
export const noteCollabTopic = (noteId: string) => `note-collab:${noteId.toLowerCase()}`;

export function useNoteCollaboration(
  noteId: string,
  initialBlocks: Block[],
  onRemoteBlocks: (blocks: Block[]) => void,
) {
  const docRef = useRef<Y.Doc | null>(null);
  const applyingRemote = useRef(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const cursorSentAt = useRef(0);
  const userRef = useRef({ id: crypto.randomUUID(), label: "Kolaborator" });

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    const shared = doc.getMap<string>("note");
    shared.set("blocks", JSON.stringify(initialBlocks));
    let cancelled = false;
    // Private channel: Realtime checks the join, broadcasts and presence against the RLS policies
    // on realtime.messages, so only the note owner and project members can receive or send.
    const channel = supabase.channel(noteCollabTopic(noteId), {
      config: {
        private: true,
        presence: { key: userRef.current.id },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      void channel.send({
        type: "broadcast",
        event: "y-update",
        payload: { update: encode(update) },
      });
    };
    doc.on("update", onUpdate);
    channel.on("broadcast", { event: "y-update" }, ({ payload }) => {
      // Only accept updates delivered on this private, authorized channel.
      if (cancelled || channelRef.current !== channel || !channel.private) return;
      if (typeof payload?.update !== "string") return;
      applyingRemote.current = true;
      try {
        Y.applyUpdate(doc, decode(payload.update), "remote");
        const value = shared.get("blocks");
        if (value) {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) onRemoteBlocks(parsed as Block[]);
        }
      } catch {
        // Malformed update: ignore it rather than breaking the editor.
      } finally {
        applyingRemote.current = false;
      }
    });
    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      if (cancelled || !channel.private || typeof payload?.id !== "string") return;
      setPeers((old) => [...old.filter((p) => p.id !== payload.id), payload as Peer]);
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Peer>();
      setPeers(
        Object.values(state)
          .flatMap((rows) => rows)
          .filter((peer) => peer.id !== userRef.current.id),
      );
    });
    // Private channels authorize with the user's JWT; make sure Realtime has the current one
    // before joining (the client also refreshes it on token refresh).
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track(userRef.current);
      });
    });
    return () => {
      cancelled = true;
      doc.off("update", onUpdate);
      doc.destroy();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [noteId]);

  function publishBlocks(blocks: Block[]) {
    const doc = docRef.current;
    if (!doc || applyingRemote.current) return;
    doc.getMap<string>("note").set("blocks", JSON.stringify(blocks));
  }
  function publishCursor(x: number, y: number) {
    const now = Date.now();
    if (now - cursorSentAt.current < 80) return;
    cursorSentAt.current = now;
    const channel = channelRef.current;
    if (channel)
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { ...userRef.current, x, y },
      });
  }
  return { peers, publishBlocks, publishCursor };
}
