import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoExamples } from "@/components/demo/DemoExamples";
import { QuickCapture } from "@/components/QuickCapture";
import {
  DEMO_AUDIO_STUB,
  DEMO_CAPTURE_EXAMPLES,
  DEMO_IMAGE_STUB,
  DEMO_MEETING_EXAMPLES,
  DEMO_VOICE_TRANSCRIPT,
} from "@/lib/demo-examples";
import { PreferencesProvider } from "@/lib/preferences";

const ai = vi.hoisted(() => ({
  transcribeVoice: vi.fn(),
  ocrImage: vi.fn(),
}));
vi.mock("@/lib/ai.functions", () => ai);

const insert = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: null })));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: () => ({ insert }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PreferencesProvider>{ui}</PreferencesProvider>
    </QueryClientProvider>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("QuickCapture in the demo", () => {
  it("starts pre-filled and switches examples with the Contoh chips", () => {
    wrap(<QuickCapture demo />);
    expect(screen.getByText("Mode demo: respons contoh")).toBeVisible();
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue(DEMO_CAPTURE_EXAMPLES[0]!.text);

    const chips = screen.getByRole("group", { name: "Contoh" });
    expect(chips.querySelectorAll("button")).toHaveLength(DEMO_CAPTURE_EXAMPLES.length);
    const second = DEMO_CAPTURE_EXAMPLES[1]!;
    fireEvent.click(screen.getByRole("button", { name: second.label.id }));
    expect(textarea).toHaveValue(second.text);
    expect(screen.getByRole("button", { name: second.label.id })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps a saved draft over the example", async () => {
    localStorage.setItem("second-brain-capture-draft", "draf saya");
    wrap(<QuickCapture demo />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("draf saya"));
  });

  it("sends the sample voice and photo stubs and files the result in the Inbox", async () => {
    ai.transcribeVoice.mockResolvedValue(DEMO_VOICE_TRANSCRIPT);
    ai.ocrImage.mockResolvedValue("Rencana Q4");
    wrap(<QuickCapture demo />);

    fireEvent.click(screen.getByRole("button", { name: "Pakai contoh suara" }));
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith({
        user_id: "u1",
        content: DEMO_VOICE_TRANSCRIPT,
        source: "voice",
      }),
    );
    expect(ai.transcribeVoice).toHaveBeenCalledWith({ data: DEMO_AUDIO_STUB });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pakai contoh foto" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pakai contoh foto" }));
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith({ user_id: "u1", content: "Rencana Q4", source: "ocr" }),
    );
    expect(ai.ocrImage).toHaveBeenCalledWith({ data: DEMO_IMAGE_STUB });
  });

  it("stays empty and shows no demo controls outside the demo", () => {
    wrap(<QuickCapture demo={false} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("Mode demo: respons contoh")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pakai contoh suara" })).not.toBeInTheDocument();
  });

  it("follows VITE_APP_MODE by default", () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    wrap(<QuickCapture />);
    expect(screen.getByRole("textbox")).toHaveValue(DEMO_CAPTURE_EXAMPLES[0]!.text);
  });
});

describe("DemoExamples", () => {
  it("renders the hint alone when there are no examples", () => {
    wrap(<DemoExamples active />);
    expect(screen.getByText("Mode demo: respons contoh")).toBeVisible();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("reports the picked example", () => {
    const onPick = vi.fn();
    wrap(<DemoExamples active examples={DEMO_MEETING_EXAMPLES} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: DEMO_MEETING_EXAMPLES[1]!.label.id }));
    expect(onPick).toHaveBeenCalledWith(DEMO_MEETING_EXAMPLES[1]);
  });

  it("translates the hint and labels to English", async () => {
    localStorage.setItem("second-brain-locale", "en");
    wrap(<DemoExamples active examples={DEMO_MEETING_EXAMPLES} />);
    expect(await screen.findByText("Demo mode: sample responses")).toBeVisible();
    expect(screen.getByRole("button", { name: DEMO_MEETING_EXAMPLES[0]!.label.en })).toBeVisible();
  });

  it("renders nothing outside the demo", () => {
    const { container } = wrap(<DemoExamples active={false} examples={DEMO_MEETING_EXAMPLES} />);
    expect(container).toBeEmptyDOMElement();
  });
});
