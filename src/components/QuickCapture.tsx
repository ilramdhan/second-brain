import { useEffect, useRef, useState } from "react";
import { Mic, Square, ImageIcon, SendHorizonal, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { transcribeVoice, ocrImage } from "@/lib/ai.functions";

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function QuickCapture({ onCaptured }: { onCaptured?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(localStorage.getItem("second-brain-capture-draft") ?? "");
  }, []);
  useEffect(() => {
    localStorage.setItem("second-brain-capture-draft", text);
  }, [text]);

  async function saveToInbox(content: string, source: "manual" | "voice" | "ocr") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("inbox_items")
      .insert({ user_id: user.id, content, source });
    if (error) toast.error("Gagal menyimpan: " + error.message);
    else {
      toast.success("Masuk ke Inbox");
      onCaptured?.();
    }
  }

  async function handleSend() {
    if (!text.trim()) return;
    setBusy(true);
    await saveToInbox(text.trim(), "manual");
    setText("");
    localStorage.removeItem("second-brain-capture-draft");
    setBusy(false);
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
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const base64 = await fileToBase64(blob);
          const transcript = await transcribeVoice({
            data: { audioBase64: base64, mimeType: blob.type },
          });
          if (transcript?.trim()) {
            await saveToInbox(transcript.trim(), "voice");
          } else {
            toast.error("Tidak ada suara yang terdeteksi");
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Transkripsi gagal");
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Izin mikrofon ditolak");
    }
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Gambar terlalu besar (maks 8MB)");
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const text = await ocrImage({ data: { imageBase64: base64, mimeType: file.type } });
      if (text?.trim()) {
        await saveToInbox(text.trim(), "ocr");
      } else {
        toast.error("Tidak ada teks yang terbaca pada gambar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "OCR gagal");
    } finally {
      setBusy(false);
    }
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
        placeholder="Tuangkan pikiran di sini… poin singkat pun tidak apa-apa, AI akan merapikannya."
        className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex gap-1">
          <button
            onClick={toggleRecording}
            disabled={busy}
            title={recording ? "Berhenti merekam" : "Rekam suara"}
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
            title="Foto catatan / papan tulis (OCR)"
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
          Simpan
        </button>
      </div>
      {recording && (
        <p className="px-2 pt-2 text-xs text-destructive">
          Merekam… ketuk lagi untuk berhenti dan transkripsi.
        </p>
      )}
    </div>
  );
}
