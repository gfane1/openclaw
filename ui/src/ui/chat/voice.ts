import { html, nothing } from "lit";

// ─── Speech-to-Text (STT) via Web Speech API ───────────────────────────

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  const cls =
    (w.SpeechRecognition as SpeechRecognitionConstructor) ??
    (w.webkitSpeechRecognition as SpeechRecognitionConstructor) ??
    null;
  console.log(
    "[Voice Debug] getSpeechRecognitionClass:",
    cls ? "found" : "NOT FOUND",
    "| SpeechRecognition:",
    !!w.SpeechRecognition,
    "| webkitSpeechRecognition:",
    !!w.webkitSpeechRecognition,
  );
  return cls;
}

export function isSttSupported(): boolean {
  const supported = getSpeechRecognitionClass() !== null;
  console.log("[Voice Debug] isSttSupported:", supported);
  return supported;
}

let activeRecognition: SpeechRecognitionInstance | null = null;
let micStream: MediaStream | null = null;

async function requestMicPermission(): Promise<{ ok: true } | { ok: false; error: string }> {
  console.log("[Voice Debug] requestMicPermission: requesting getUserMedia({audio: true})...");

  // Check if mediaDevices API is available at all
  if (!navigator.mediaDevices?.getUserMedia) {
    const msg = "navigator.mediaDevices.getUserMedia not available (requires HTTPS or localhost)";
    console.error("[Voice Debug]", msg);
    return { ok: false, error: msg };
  }

  // Try progressively looser audio constraints
  const attempts: Array<{ label: string; constraints: MediaStreamConstraints }> = [
    { label: "default", constraints: { audio: true } },
    {
      label: "relaxed",
      constraints: {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      },
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      console.log("[Voice Debug] requestMicPermission: trying constraints:", attempt.label);
      const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      // Keep a reference so the browser shows the mic-active indicator
      micStream = stream;
      const tracks = stream.getAudioTracks();
      console.log(
        "[Voice Debug] requestMicPermission: SUCCESS with '%s'.",
        attempt.label,
        tracks.length,
        "audio track(s).",
        tracks.map((t) => `${t.label} (${t.readyState})`),
      );
      return { ok: true };
    } catch (err) {
      lastError = err;
      console.warn("[Voice Debug] requestMicPermission: '%s' failed:", attempt.label, err);
    }
  }

  // All attempts failed - build a meaningful error message
  const domErr = lastError instanceof DOMException ? lastError : null;
  const errName = domErr?.name ?? "Unknown";
  const errMsg = domErr?.message ?? String(lastError);
  console.error("[Voice Debug] requestMicPermission: ALL attempts failed:", errName, errMsg);

  if (errName === "NotAllowedError") {
    return { ok: false, error: "Microphone permission denied — check browser site permissions" };
  }
  if (errName === "NotFoundError") {
    return { ok: false, error: "No microphone found — check your audio input device" };
  }
  if (errName === "NotReadableError" || errName === "AbortError") {
    return {
      ok: false,
      error: "Microphone is busy or unavailable — another app may be using it",
    };
  }
  if (errName === "OverconstrainedError") {
    return { ok: false, error: "Microphone does not support the requested audio format" };
  }
  return { ok: false, error: `Microphone error: ${errName} — ${errMsg}` };
}

function releaseMicStream(): void {
  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    micStream = null;
  }
}

export async function startStt(opts: {
  onResult: (transcript: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (error: string) => void;
  lang?: string;
}): Promise<void> {
  console.log("[Voice Debug] startStt: called");
  stopStt();

  const SpeechRecognition = getSpeechRecognitionClass();
  if (!SpeechRecognition) {
    console.error("[Voice Debug] startStt: SpeechRecognition API not available");
    opts.onError("Speech recognition not supported in this browser");
    return;
  }

  // Explicitly request mic permission first to trigger the browser prompt
  const micResult = await requestMicPermission();
  if (!micResult.ok) {
    console.error("[Voice Debug] startStt: Mic failed:", micResult.error);
    opts.onError(micResult.error);
    return;
  }

  console.log("[Voice Debug] startStt: creating SpeechRecognition instance...");
  const recognition = new SpeechRecognition();
  recognition.lang = opts.lang ?? navigator.language ?? "en-US";
  recognition.interimResults = true;
  recognition.continuous = true;
  console.log(
    "[Voice Debug] startStt: config lang=%s, interimResults=%s, continuous=%s",
    recognition.lang,
    recognition.interimResults,
    recognition.continuous,
  );

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      console.log("[Voice Debug] STT final transcript:", finalTranscript);
      opts.onResult(finalTranscript, true);
    } else if (interimTranscript) {
      console.log("[Voice Debug] STT interim transcript:", interimTranscript);
      opts.onResult(interimTranscript, false);
    }
  };

  recognition.addEventListener("error", (event: { error: string }) => {
    console.error("[Voice Debug] STT error:", event.error);
    if (event.error !== "aborted" && event.error !== "no-speech") {
      opts.onError(event.error);
    }
  });

  recognition.onend = () => {
    console.log("[Voice Debug] STT session ended");
    activeRecognition = null;
    releaseMicStream();
    opts.onEnd();
  };

  activeRecognition = recognition;
  console.log("[Voice Debug] startStt: calling recognition.start()...");
  try {
    recognition.start();
    console.log("[Voice Debug] startStt: recognition.start() succeeded");
  } catch (err) {
    console.error("[Voice Debug] startStt: recognition.start() threw:", err);
    opts.onError(String(err));
  }
}

export function stopStt(): void {
  console.log("[Voice Debug] stopStt: called, activeRecognition =", !!activeRecognition);
  if (activeRecognition) {
    activeRecognition.stop();
    activeRecognition = null;
  }
  releaseMicStream();
}

export function isSttActive(): boolean {
  return activeRecognition !== null;
}

// ─── Text-to-Speech (TTS) via Web Speech API ───────────────────────────

export function isTtsSupported(): boolean {
  return "speechSynthesis" in window;
}

let activeTtsUtterance: SpeechSynthesisUtterance | null = null;

export function speakText(text: string, onEnd?: () => void): void {
  stopTts();

  if (!isTtsSupported() || !text.trim()) {
    return;
  }

  // Strip Markdown formatting for cleaner speech
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();

  if (!cleaned) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = navigator.language ?? "en-US";
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    activeTtsUtterance = null;
    onEnd?.();
  };

  utterance.addEventListener("error", () => {
    activeTtsUtterance = null;
    onEnd?.();
  });

  activeTtsUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopTts(): void {
  if (isTtsSupported()) {
    window.speechSynthesis.cancel();
  }
  activeTtsUtterance = null;
}

export function isTtsActive(): boolean {
  return activeTtsUtterance !== null && window.speechSynthesis.speaking;
}

// ─── Render helpers ─────────────────────────────────────────────────────

const micIcon = html`
  <svg viewBox="0 0 24 24">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
`;

const speakerIcon = html`
  <svg viewBox="0 0 24 24">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
`;

export function renderMicButton(opts: { disabled: boolean; onTranscript: (text: string) => void }) {
  if (!isSttSupported()) {
    console.warn("[Voice Debug] renderMicButton: STT not supported, hiding button");
    return nothing;
  }
  console.log("[Voice Debug] renderMicButton: rendering (disabled=%s)", opts.disabled);

  const handleClick = async (e: Event) => {
    console.log(
      "[Voice Debug] Mic button clicked, isSttActive:",
      isSttActive(),
      "disabled:",
      opts.disabled,
    );
    const btn = (e.currentTarget ?? e.target) as HTMLButtonElement;
    if (isSttActive()) {
      console.log("[Voice Debug] Stopping active STT session");
      stopStt();
      btn.classList.remove("voice-mic-btn--active");
      btn.title = "Voice input";
      btn.setAttribute("aria-label", "Voice input");
    } else {
      console.log("[Voice Debug] Starting new STT session...");
      btn.classList.add("voice-mic-btn--active");
      btn.title = "Listening… click to stop";
      btn.setAttribute("aria-label", "Listening… click to stop");
      await startStt({
        onResult: (transcript, isFinal) => {
          console.log("[Voice Debug] onResult: isFinal=%s transcript=%s", isFinal, transcript);
          if (isFinal) {
            opts.onTranscript(transcript);
          }
        },
        onEnd: () => {
          console.log("[Voice Debug] onEnd: STT session ended, resetting button");
          btn.classList.remove("voice-mic-btn--active");
          btn.title = "Voice input";
          btn.setAttribute("aria-label", "Voice input");
        },
        onError: (err) => {
          console.error("[Voice Debug] onError:", err);
          btn.classList.remove("voice-mic-btn--active");
          btn.title = `Voice error: ${err}`;
          btn.setAttribute("aria-label", "Voice input");
        },
      });
    }
  };

  return html`
    <button
      class="btn voice-mic-btn"
      type="button"
      ?disabled=${opts.disabled}
      @click=${handleClick}
      aria-label="Voice input"
      title="Voice input"
    >
      ${micIcon}
    </button>
  `;
}

export function renderTtsButton(text: string) {
  if (!isTtsSupported() || !text.trim()) {
    return nothing;
  }

  const handleClick = (e: Event) => {
    const btn = (e.currentTarget ?? e.target) as HTMLButtonElement;
    if (isTtsActive()) {
      stopTts();
      btn.classList.remove("chat-tts-btn--active");
      btn.title = "Read aloud";
      btn.setAttribute("aria-label", "Read aloud");
    } else {
      btn.classList.add("chat-tts-btn--active");
      btn.title = "Stop speaking";
      btn.setAttribute("aria-label", "Stop speaking");
      speakText(text, () => {
        btn.classList.remove("chat-tts-btn--active");
        btn.title = "Read aloud";
        btn.setAttribute("aria-label", "Read aloud");
      });
    }
  };

  return html`
    <button
      class="chat-tts-btn"
      type="button"
      @click=${handleClick}
      aria-label="Read aloud"
      title="Read aloud"
    >
      ${speakerIcon}
    </button>
  `;
}
