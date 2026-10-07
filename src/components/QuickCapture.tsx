import { useEffect, useRef, useState } from "react";
import { Mic, Square, ImageIcon, SendHorizonal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { DemoExamples } from "@/components/demo/DemoExamples";
import { transcribeVoice, ocrImage } from "@/lib/ai.functions";
import { isDemo } from "@/lib/app-mode";
import { DEMO_AUDIO_STUB, DEMO_CAPTURE_EXAMPLES, DEMO_IMAGE_STUB } from "@/lib/demo-examples";
import { toastError } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const DRAFT_KEY = "second-brain-capture-draft";

export function QuickCapture({
  onCaptured,
  demo = isDemo(),
}: {
  onCaptured?: () => void;
  /** Public demo: pre-filled example, "Contoh" chips and sample voice/photo buttons. */
  demo?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = usePreferences();
  const [text, setText] = useState(() => (demo ? DEMO_CAPTURE_EXAMPLES[0]!.text : ""));
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY);
    // In the demo an empty draft keeps the pre-filled example.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the draft from localStorage after mount (not available during SSR).
    if (draft || !demo) setText(draft ?? "");
  }, [demo]);
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, text);
  }, [text]);
  const selectedExample = DEMO_CAPTURE_EXAMPLES.find((e) => e.text === text)?.key ?? null;

  async function saveToInbox(content: string, source: "manual" | "voice" | "ocr") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("inbox_items")
      .insert({ user_id: user.id, content, source });
    if (error) toastError(error, t("wsCaptureSaveFailed"));
    else {
      toast.success(t("wsCaptureSaved"));
      void qc.invalidateQueries({ queryKey: ["inbox-count"] });
      onCaptured?.();
    }
  }

  async function handleSend() {
    if (!text.trim()) return;
    setBusy(true);
    await saveToInbox(text.trim(), "manual");
    setText("");
    localStorage.removeItem(DRAFT_KEY);
    setBusy(false);
  }

  /** Sends a recording (or the demo stub) for transcription and files the text in the Inbox. */
  async function transcribe(audio: () => Promise<{ audioBase64: string; mimeType: string }>) {
    setBusy(true);
    try {
      const transcript = await transcribeVoice({ data: await audio() });
      if (transcript?.trim()) {
        await saveToInbox(transcript.trim(), "voice");
      } else {
        toast.error(t("wsCaptureNoSpeech"));
      }
    } catch (err) {
      toastError(err, t("wsCaptureTranscribeFailed"));
    } finally {
      setBusy(false);
    }
  }

  /** Sends a photo (or the demo stub) for OCR and files the text in the Inbox. */
  async function readImage(image: () => Promise<{ imageBase64: string; mimeType: string }>) {
    setBusy(true);
    try {
      const text = await ocrImage({ data: await image() });
      if (text?.trim()) {
        await saveToInbox(text.trim(), "ocr");
      } else {
        toast.error(t("wsCaptureNoText"));
      }
    } catch (err) {
      toastError(err, t("wsCaptureOcrFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await transcribe(async () => ({
          audioBase64: await fileToBase64(blob),
          mimeType: blob.type,
        }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error(t("wsCaptureMicDenied"));
    }
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t("wsCaptureImageTooLarge"));
      return;
    }
    await readImage(async () => ({ imageBase64: await fileToBase64(file), mimeType: file.type }));
  }

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        rows={2}
        placeholder={t("wsCapturePlaceholder")}
        className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex gap-1">
          <button
            onClick={toggleRecording}
            disabled={busy}
            title={recording ? t("wsCaptureStopRecording") : t("wsCaptureRecord")}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              recording
                ? "bg-destructive text-destructive-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title={t("wsCapturePhoto")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImage}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={busy || !text.trim()}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizonal className="h-4 w-4" />
          )}
          {t("wsSave")}
        </button>
      </div>
      <DemoExamples
        active={demo}
        className="border-t px-1 pt-2"
        examples={DEMO_CAPTURE_EXAMPLES}
        selected={selectedExample}
        onPick={(example) => setText(example.text)}
      >
        <button
          type="button"
          onClick={() => transcribe(async () => ({ ...DEMO_AUDIO_STUB }))}
          disabled={busy || recording}
          className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Mic className="h-3 w-3" aria-hidden />
          {t("demoAiVoiceExample")}
        </button>
        <button
          type="button"
          onClick={() => readImage(async () => ({ ...DEMO_IMAGE_STUB }))}
          disabled={busy}
          className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-50"
        >
          <ImageIcon className="h-3 w-3" aria-hidden />
          {t("demoAiImageExample")}
        </button>
      </DemoExamples>
      {recording && (
        <p className="px-2 pt-2 text-xs text-destructive">
          Merekam… ketuk lagi untuk berhenti dan transkripsi.
        </p>
      )}
    </div>
  );
}
