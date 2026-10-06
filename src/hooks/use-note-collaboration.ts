import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import type { Block } from "@/lib/blocks";
import {
  applyBlocksToDoc,
  blocksArray,
  decodeUpdate,
  dedupeBlocks,
  docToBlocks,
  electLeader,
  encodeUpdate,
  reuseUnchanged,
  seedUpdate,
} from "@/lib/note-ydoc";

type Peer = { id: string; label: string; v?: number; x?: number; y?: number };

/**
 * Protocol version of the granular doc (Phase 4.3). Old clients broadcast the whole note as JSON
 * on `y-update`; this version uses its own `y2-*` events and tags its presence with `v`, so during
 * a deploy old and new tabs ignore each other's document traffic instead of corrupting it.
 */
export const COLLAB_VERSION = 2;
const EV_UPDATE = "y2-update";
const EV_SYNC_REQ = "y2-sync-req";
const EV_SYNC = "y2-sync";
/** How long a joining peer waits for an existing peer's state before seeding from the saved note. */
const JOIN_TIMEOUT_MS = 1500;
/** Anti-entropy: Realtime broadcasts are best effort, so peers compare state vectors periodically. */
const RESYNC_MS = 20_000;
const LOCAL = "local";
const REMOTE = "remote";

/**
 * Realtime topic for a note's collaboration channel. Must stay in sync with
 * `public.note_collab_topic_note_id` (migration 0009), which only authorizes
 * `note-collab:<lowercase uuid>` on private channels.
 */
export const noteCollabTopic = (noteId: string) => `note-collab:${noteId.toLowerCase()}`;

/** True when `remote` (a state vector) is missing operations that `doc` has. */
function isBehind(doc: Y.Doc, remote: Uint8Array): boolean {
  const theirs = Y.decodeStateVector(remote);
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(doc)))
    if ((theirs.get(client) ?? 0) < clock) return true;
  return false;
}

/**
 * Live collaboration for one note over the private Realtime channel `note-collab:<id>`.
 *
 * - The blocks live in a granular Y.Doc (`src/lib/note-ydoc.ts`), so each edit broadcasts only the
 *   changed block's delta.
 * - `isLeader` tells the page whether this tab is the one peer that autosaves block changes
 *   (lowest presence key among peers on this protocol version; alone, always itself).
 * - `notes.blocks` stays the durable state: the page saves through `useNoteActions`.
 */
export function useNoteCollaboration(
  noteId: string,
  initialBlocks: Block[],
  /** `isLeader` is this tab's leadership at delivery time (whether it should autosave). */
  onRemoteBlocks: (blocks: Block[], isLeader: boolean) => void,
  onLeaderChange?: (leader: boolean) => void,
) {
  const docRef = useRef<Y.Doc | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [leader, setLeader] = useState(true);
  const leaderRef = useRef(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const cursorSentAt = useRef(0);
  const userRef = useRef({ id: crypto.randomUUID(), label: "Kolaborator", v: COLLAB_VERSION });
  // Ready once the doc holds the shared state (synced from a peer or seeded from the saved note).
  const readyRef = useRef(false);
  const pendingRef = useRef<Block[] | null>(null);
  const shownRef = useRef<Block[]>(initialBlocks);
  const initialRef = useRef(initialBlocks);
  const remoteCb = useRef(onRemoteBlocks);
  // Synced after commit (not during render) so stable callbacks read the latest values.
  useLayoutEffect(() => {
    remoteCb.current = onRemoteBlocks;
  });
  const leaderCb = useRef(onLeaderChange);
  // Synced after commit (not during render) so stable callbacks read the latest values.
  useLayoutEffect(() => {
    leaderCb.current = onLeaderChange;
  });

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    readyRef.current = false;
    pendingRef.current = null;
    let cancelled = false;
    let joinTimer: ReturnType<typeof setTimeout> | null = null;
    let resync: ReturnType<typeof setInterval> | null = null;
    const selfId = userRef.current.id;

    // Private channel: Realtime checks the join, broadcasts and presence against the RLS policies
    // on realtime.messages, so only the note owner and project members can receive or send.
    const channel = supabase.channel(noteCollabTopic(noteId), {
      config: {
        private: true,
        presence: { key: selfId },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;
    const live = () => !cancelled && channelRef.current === channel && channel.private;
    const send = (event: string, payload: Record<string, unknown>) =>
      void channel.send({ type: "broadcast", event, payload });

    const showDoc = () => {
      const prev = shownRef.current;
      const next = reuseUnchanged(prev, docToBlocks(doc));
      if (next.length === prev.length && next.every((b, i) => b === prev[i])) return;
      shownRef.current = next;
      remoteCb.current(next, leaderRef.current);
    };

    // Ready: the doc holds the shared state. Local edits made while joining are diffed onto it.
    const markReady = () => {
      if (readyRef.current || cancelled) return;
      if (joinTimer) clearTimeout(joinTimer);
      joinTimer = null;
      const seeded = blocksArray(doc).length === 0;
      if (seeded) Y.applyUpdate(doc, seedUpdate(noteId, initialRef.current));
      dedupeBlocks(doc, LOCAL);
      readyRef.current = true;
      const pending = pendingRef.current;
      pendingRef.current = null;
      // Edits typed before joining were made against the saved note; replaying them onto a peer's
      // newer state would undo that peer's work, so they only survive when we seeded ourselves.
      if (pending && seeded) applyBlocksToDoc(doc, pending, LOCAL);
      else showDoc();
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL && readyRef.current) send(EV_UPDATE, { update: encodeUpdate(update) });
    });

    const applyRemote = (encoded: unknown) => {
      if (typeof encoded !== "string") return;
      try {
        Y.applyUpdate(doc, decodeUpdate(encoded), REMOTE);
      } catch {
        // Malformed update: ignore it rather than breaking the editor.
        return;
      }
      if (!readyRef.current) return;
      dedupeBlocks(doc, LOCAL);
      showDoc();
    };

    channel.on("broadcast", { event: EV_UPDATE }, ({ payload }) => {
      if (live()) applyRemote(payload?.update);
    });
    channel.on("broadcast", { event: EV_SYNC_REQ }, ({ payload }) => {
      if (!live() || !readyRef.current || typeof payload?.sv !== "string") return;
      if (typeof payload.from !== "string" || payload.from === selfId) return;
      try {
        const sv = decodeUpdate(payload.sv);
        // A joining peer always gets an answer; periodic checks only when it is missing something.
        if (payload.join !== true && !isBehind(doc, sv)) return;
        send(EV_SYNC, { to: payload.from, update: encodeUpdate(Y.encodeStateAsUpdate(doc, sv)) });
      } catch {
        // Ignore malformed state vectors.
      }
    });
    channel.on("broadcast", { event: EV_SYNC }, ({ payload }) => {
      if (!live() || payload?.to !== selfId) return;
      applyRemote(payload.update);
      if (!readyRef.current && blocksArray(doc).length > 0) markReady();
    });
    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      if (cancelled || !channel.private || typeof payload?.id !== "string") return;
      setPeers((old) => [...old.filter((p) => p.id !== payload.id), payload as Peer]);
    });

    let tracked = false;
    channel.on("presence", { event: "sync" }, () => {
      const all = Object.values(channel.presenceState<Peer>()).flatMap((rows) => rows);
      const others = all.filter((peer) => peer.id !== selfId);
      setPeers(others);
      const current = others.filter((p) => p.v === COLLAB_VERSION).map((p) => p.id);
      const isLeader = electLeader(selfId, current) === selfId;
      if (isLeader !== leaderRef.current) {
        leaderRef.current = isLeader;
        setLeader(isLeader);
        leaderCb.current?.(isLeader);
      }
      // Nobody else on this protocol: no state to wait for.
      if (tracked && !readyRef.current && current.length === 0) markReady();
    });

    // Private channels authorize with the user's JWT; make sure Realtime has the current one
    // before joining (the client also refreshes it on token refresh).
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        void channel.track(userRef.current).then(() => {
          tracked = true;
        });
        // Ask the peers already editing for their state (also after a reconnect).
        send(EV_SYNC_REQ, {
          from: selfId,
          join: !readyRef.current,
          sv: encodeUpdate(Y.encodeStateVector(doc)),
        });
        if (!readyRef.current && !joinTimer) joinTimer = setTimeout(markReady, JOIN_TIMEOUT_MS);
      });
    });
    // Offline or never subscribed: still keep a working local doc.
    const offline = setTimeout(markReady, JOIN_TIMEOUT_MS * 3);
    resync = setInterval(() => {
      if (readyRef.current && live())
        send(EV_SYNC_REQ, { from: selfId, sv: encodeUpdate(Y.encodeStateVector(doc)) });
    }, RESYNC_MS);

    return () => {
      cancelled = true;
      if (joinTimer) clearTimeout(joinTimer);
      clearTimeout(offline);
      if (resync) clearInterval(resync);
      doc.destroy();
      docRef.current = null;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [noteId]);

  /** Mirror the editor's blocks into the doc; only the changed parts are broadcast. */
  const publishBlocks = useCallback((blocks: Block[]) => {
    shownRef.current = blocks;
    const doc = docRef.current;
    if (!doc) return;
    if (!readyRef.current) {
      pendingRef.current = blocks;
      return;
    }
    applyBlocksToDoc(doc, blocks, LOCAL);
  }, []);

  const publishCursor = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - cursorSentAt.current < 80) return;
    cursorSentAt.current = now;
    const channel = channelRef.current;
    if (channel)
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { id: userRef.current.id, label: userRef.current.label, x, y },
      });
  }, []);

  const isLeader = useCallback(() => leaderRef.current, []);

  return { peers, leader, isLeader, publishBlocks, publishCursor };
}
