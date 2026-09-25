"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Swords, X } from "lucide-react";
import type { GenerationEvent } from "@catgpt/types";
import { API_URL } from "@/lib/config";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands, useBrandVoice, useCreateGeneration } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { detectSpeakLanguage } from "@/lib/voice";

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

const SPEECH_RMS = 0.025; // input level that counts as speech
const END_SILENCE_MS = 1300; // quiet this long after speech = turn over
const MAX_LISTEN_MS = 30_000;
const NO_SPEECH_MS = 10_000; // give up if nothing is said

/** Cut the next speakable sentence off the front of a streaming buffer. */
function takeSentence(buf: string, min: number): [string, string] | null {
  const m = /[.!?।]["')\]]?(\s|$)|\n/.exec(buf.slice(min));
  if (!m) return null;
  const end = min + m.index + m[0].length;
  const sentence = buf.slice(0, end).trim();
  return sentence ? [sentence, buf.slice(end)] : null;
}

/**
 * "Kill Bill" - hands-free voice conversation. Mic -> silence detection ->
 * transcription -> normal chat turn (saved in history) -> reply spoken
 * sentence by sentence as it streams, then it listens again.
 */
export function KillBill({ onClose }: { onClose: () => void }) {
  const { getToken } = useAuth();
  const create = useCreateGeneration();
  const { data: brands } = useBrands();
  const { brandId: chosenBrand } = useBrandMode();
  const { activeConversationId, openConversation } = useStudio();

  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Everything the async loop touches lives in refs so callbacks never go stale.
  const alive = useRef(true);
  const convRef = useRef<string | null>(activeConversationId);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const esRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Promise<Blob | null>[]>([]);
  const playingRef = useRef(false);
  const streamDoneRef = useRef(true);
  const turnRef = useRef(0); // bumps on every interrupt so stale work is ignored
  const brandId = resolveActiveBrand(brands, chosenBrand)?.id;
  const brandRef = useRef(brandId);
  brandRef.current = brandId;
  // Saved brand voice (owner-only endpoint — members get nothing and we just
  // keep the fixed /voice/speak voice). Paired with the brand id it belongs to
  // so a mid-session brand switch can't borrow the previous brand's voice.
  const { data: voiceInfo } = useBrandVoice(brandId ?? null);
  const voiceRef = useRef<{
    brandId: string;
    sampleLanguage: string;
    speakLanguages: string[];
  } | null>(null);
  voiceRef.current =
    brandId && voiceInfo?.voice?.status === "ready"
      ? {
          brandId,
          sampleLanguage: voiceInfo.voice.sampleLanguage,
          speakLanguages: voiceInfo.speakLanguages,
        }
      : null;

  const stopListening = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  const stopSpeaking = useCallback(() => {
    turnRef.current++;
    esRef.current?.close();
    esRef.current = null;
    queueRef.current = [];
    playingRef.current = false;
    streamDoneRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Something went wrong");
    setPhase("error");
  }, []);

  /* ------------------------------ speaking ------------------------------ */

  const listenRef = useRef<() => void>(() => {});

  const playNext = useCallback(
    async (turn: number) => {
      if (playingRef.current) return;
      playingRef.current = true;
      try {
        while (queueRef.current.length && turnRef.current === turn && alive.current) {
          const blob = await queueRef.current.shift()!;
          if (!blob || turnRef.current !== turn || !alive.current) continue;
          setPhase("speaking");
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
          });
          URL.revokeObjectURL(url);
        }
      } finally {
        playingRef.current = false;
      }
      // Nothing left to say and the reply is complete -> listen again.
      if (
        turnRef.current === turn &&
        alive.current &&
        streamDoneRef.current &&
        queueRef.current.length === 0
      ) {
        listenRef.current();
      }
    },
    [],
  );

  const enqueueSpeech = useCallback(
    (text: string, turn: number) => {
      const fixed = () =>
        apiFetchBlob("/voice/speak", { method: "POST", json: { text } });
      // Cloned brand voice when the owner has one; a synthesis failure quietly
      // falls back to the fixed voice so the conversation keeps talking.
      const voice = voiceRef.current;
      const p = (
        voice && voice.brandId === brandRef.current
          ? apiFetchBlob(`/brands/${voice.brandId}/voice/speak`, {
              method: "POST",
              json: {
                text,
                language: detectSpeakLanguage(
                  text,
                  voice.sampleLanguage,
                  voice.speakLanguages,
                ),
              },
            }).catch(fixed)
          : fixed()
      ).catch(() => null);
      queueRef.current.push(p);
      void playNext(turn);
    },
    [playNext],
  );

  /* ------------------------------ the reply ----------------------------- */

  const streamReply = useCallback(
    async (generationId: string, turn: number) => {
      const token = await getToken();
      if (turnRef.current !== turn) return;
      streamDoneRef.current = false;
      let buf = "";
      let spoken = 0; // characters of the reply already queued for speech
      let first = true;
      const es = new EventSource(
        `${API_URL}/generations/${generationId}/events?token=${encodeURIComponent(token ?? "")}`,
      );
      esRef.current = es;

      const flush = (all: boolean) => {
        for (;;) {
          const cut = takeSentence(buf, first ? 12 : 24);
          if (!cut) break;
          enqueueSpeech(cut[0], turn);
          spoken += buf.length - cut[1].length;
          buf = cut[1];
          first = false;
        }
        if (all && buf.trim()) {
          enqueueSpeech(buf.trim(), turn);
          spoken += buf.length;
          buf = "";
        }
      };

      es.onmessage = (msg) => {
        if (turnRef.current !== turn) return es.close();
        const evt = JSON.parse(msg.data) as GenerationEvent;
        if (evt.delta) {
          setReply((r) => r + evt.delta);
          buf += evt.delta;
          flush(false);
        }
        if (evt.status === "completed" || evt.status === "failed") {
          es.close();
          if (evt.status === "failed") {
            streamDoneRef.current = true;
            return fail(new Error(evt.error ?? "The reply failed"));
          }
          // Anything the stream missed (e.g. reconnect) comes from the final text.
          if (evt.textResponse && evt.textResponse.length > spoken + buf.length) {
            buf += evt.textResponse.slice(spoken + buf.length);
            setReply(evt.textResponse);
          }
          flush(true);
          streamDoneRef.current = true;
          if (queueRef.current.length === 0 && !playingRef.current) listenRef.current();
        }
      };
      es.onerror = () => {
        es.close();
        if (turnRef.current === turn && !streamDoneRef.current) {
          streamDoneRef.current = true;
          flush(true);
          if (queueRef.current.length === 0 && !playingRef.current) listenRef.current();
        }
      };
    },
    [enqueueSpeech, fail, getToken],
  );

  const sendTurn = useCallback(
    async (blob: Blob) => {
      const turn = turnRef.current;
      setPhase("thinking");
      try {
        const form = new FormData();
        form.append("file", blob, "speech.webm");
        const { text } = await apiFetch<{ text: string }>("/voice/transcribe", {
          method: "POST",
          body: form,
        });
        if (turnRef.current !== turn || !alive.current) return;
        if (text.trim().length < 2) return listenRef.current();
        setHeard(text);
        setReply("");
        const res = await create.mutateAsync({
          prompt: text,
          voice: true,
          conversationId: convRef.current ?? undefined,
          brandId: brandRef.current,
        });
        convRef.current = res.conversationId;
        openConversation(res.conversationId);
        await streamReply(res.generationId, turn);
      } catch (e) {
        if (turnRef.current === turn) fail(e);
      }
    },
    [create, fail, openConversation, streamReply],
  );

  /* ------------------------------ listening ----------------------------- */

  const listen = useCallback(async () => {
    if (!alive.current) return;
    setError(null);
    if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
      return fail(new Error("Microphone access requires a secure HTTPS connection."));
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return fail(new Error("Microphone recording is not supported by this browser."));
    }
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      return fail(new Error("Microphone access was blocked. Allow it and tap the orb."));
    }
    if (!alive.current) return;

    const stream = streamRef.current;
    const mime =
      typeof MediaRecorder.isTypeSupported === "function"
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
            (t) => MediaRecorder.isTypeSupported(t),
          )
        : undefined;
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    let spoke = false;
    recRef.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(rafRef.current);
      if (!alive.current) return;
      if (!spoke) return setPhase("idle");
      const chunkType = chunks.find(
        (chunk): chunk is Blob => chunk instanceof Blob && Boolean(chunk.type),
      )?.type;
      void sendTurn(new Blob(chunks, { type: rec.mimeType || chunkType || mime || "audio/webm" }));
    };

    audioCtxRef.current ??= new AudioContext();
    const ctx = audioCtxRef.current;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastVoice = startedAt;

    rec.start(250);
    setPhase("listening");
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const now = performance.now();
      if (Math.sqrt(sum / data.length) > SPEECH_RMS) {
        spoke = true;
        lastVoice = now;
      }
      const overtime = now - startedAt > MAX_LISTEN_MS;
      const finished = spoke && now - lastVoice > END_SILENCE_MS;
      const nothing = !spoke && now - startedAt > NO_SPEECH_MS;
      if (overtime || finished || nothing) {
        if (rec.state !== "inactive") rec.stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [fail, sendTurn]);
  listenRef.current = () => void listen();

  /* ------------------------------- lifecycle ---------------------------- */

  useEffect(() => {
    alive.current = true;
    void listen();
    return () => {
      alive.current = false;
      stopListening();
      stopSpeaking();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapOrb = () => {
    if (phase === "listening") return stopListening(); // send what I said now
    if (phase === "speaking" || phase === "thinking") {
      stopSpeaking();
      return void listen();
    }
    void listen();
  };

  const label: Record<Phase, string> = {
    idle: "Tap to talk",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking — tap to interrupt",
    error: "Tap to try again",
  };

  return (
    <div className="safe-area-overlay fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background/95 backdrop-blur">
      <button
        onClick={onClose}
        aria-label="Close Kill Bill"
        className="safe-area-top-right absolute rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground">
        <Swords className="h-4 w-4" /> KILL BILL
      </div>

      <button
        onClick={tapOrb}
        aria-label={label[phase]}
        className={cn(
          "relative flex h-40 w-40 items-center justify-center rounded-full border-2 transition-all",
          phase === "listening" && "scale-110 border-primary bg-primary/20 shadow-[0_0_60px_-10px] shadow-primary",
          phase === "speaking" && "border-primary bg-primary/30 shadow-[0_0_80px_-10px] shadow-primary",
          phase === "thinking" && "border-muted-foreground/50",
          phase === "idle" && "border-muted-foreground/40",
          phase === "error" && "border-destructive",
        )}
      >
        {(phase === "listening" || phase === "speaking") && (
          <span className="absolute inset-0 animate-ping rounded-full border border-primary/40" />
        )}
        {phase === "thinking" ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <Mic className={cn("h-10 w-10", phase === "error" ? "text-destructive" : "text-primary")} />
        )}
      </button>

      <p className="text-sm text-muted-foreground">{label[phase]}</p>

      <div className="flex min-h-24 w-full max-w-xl flex-col gap-3 text-center">
        {heard && <p className="text-sm text-muted-foreground">“{heard}”</p>}
        {reply && <p className="line-clamp-6 text-base leading-relaxed">{reply}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
