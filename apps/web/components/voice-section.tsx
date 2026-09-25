"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Mic,
  Play,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import type { BrandDto } from "@catgpt/types";
import { apiFetchBlob } from "@/lib/api";
import {
  useBrandVoice,
  useBrandVoiceScript,
  useDeleteBrandVoice,
  useSaveBrandVoice,
} from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_SPEAK_CHARS = 1500;

/** MediaRecorder output (webm/mp4) → mono 16-bit PCM WAV, which the API and
 *  the model service can decode with zero extra dependencies. */
async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = decoded.length;
    const channels = decoded.numberOfChannels;
    const pcm = new Float32Array(frames);
    const chans: Float32Array[] = [];
    for (let c = 0; c < channels; c++) chans.push(decoded.getChannelData(c));
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const d of chans) sum += d[i] ?? 0;
      pcm[i] = sum / channels;
    }
    const sr = decoded.sampleRate;
    const out = new ArrayBuffer(44 + frames * 2);
    const v = new DataView(out);
    const wstr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    wstr(0, "RIFF");
    v.setUint32(4, 36 + frames * 2, true);
    wstr(8, "WAVE");
    wstr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, "data");
    v.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([out], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return "";
  }
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function playBlob(blob: Blob, onDone?: () => void): HTMLAudioElement {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const done = () => {
    URL.revokeObjectURL(url);
    onDone?.();
  };
  audio.onended = done;
  audio.onerror = done;
  audio.onpause = done; // our only pause path is the Stop button
  void audio.play();
  return audio;
}

/**
 * Brand voice: owner-only enrollment + testing. Renders nothing when the API
 * answers 404 (a workspace member can read the brand but not manage its voice).
 */
export function VoiceSection({ brand }: { brand: BrandDto }) {
  const info = useBrandVoice(brand.id);
  const save = useSaveBrandVoice();
  const del = useDeleteBrandVoice();

  const [language, setLanguage] = useState<string | null>(null);
  const [speakLanguage, setSpeakLanguage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentType, setConsentType] = useState<"own_voice" | "authorized_voice">(
    "own_voice",
  );
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [wav, setWav] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakText, setSpeakText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [speakPlaying, setSpeakPlaying] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const [savedSpeakKey, setSavedSpeakKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sample" | null>(null);
  const [rerecord, setRerecord] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakCacheRef = useRef(new Map<string, Blob>());
  const previewUrlRef = useRef<string | null>(null);

  const voice = info.data?.voice ?? null;
  const languages = info.data?.languages ?? [];
  const speakLanguages = info.data?.speakLanguages ?? [];
  const script = useBrandVoiceScript(brand.id, language ?? languages[0] ?? null);

  // Keeps the blob URL reachable from the unmount cleanup — a state value in
  // that closure would be stale (always the initial null).
  const setPreview = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  useEffect(
    () => () => {
      if (recRef.current?.state !== "inactive") recRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      speakAudioRef.current?.pause();
    },
    [],
  );

  // Nothing to show when the brand voice endpoint is unavailable to this user.
  if (info.isError || (info.isSuccess && !info.data)) return null;
  if (info.isSuccess && !info.data.voice && info.data.languages.length === 0) {
    return null;
  }

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn't available in this browser (needs HTTPS)");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        try {
          const raw = new Blob(chunksRef.current, {
            type: rec.mimeType || mime || "audio/webm",
          });
          const wavBlob = await blobToWav(raw);
          setWav(wavBlob);
          setPreview(URL.createObjectURL(wavBlob));
        } catch {
          setError("Couldn't process that recording — please try again");
        }
        setRecording(false);
      };
      rec.start(250);
      setRecording(true);
      setWav(null);
    } catch {
      setError("Microphone access was denied or is unavailable");
    }
  };

  const stopRecording = () => {
    if (recRef.current?.state !== "inactive") recRef.current?.stop();
  };

  const saveVoice = () => {
    if (!wav || !consent) return;
    const lang = language ?? languages[0];
    if (!lang) return;
    setError(null);
    save.mutate(
      { brandId: brand.id, file: wav, language: lang, consentType },
      {
        onSuccess: () => {
          setWav(null);
          setPreview(null);
          setConsent(false);
          setRerecord(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  const playSample = async () => {
    setBusy("sample");
    setError(null);
    try {
      playBlob(await apiFetchBlob(`/brands/${brand.id}/voice/sample`));
    } catch {
      setError("Couldn't load the saved sample");
    } finally {
      setBusy(null);
    }
  };

  const speak = async () => {
    const text = speakText.trim();
    if (!text || !voice) return;
    const language = speakLanguage ?? voice.sampleLanguage;
    const cacheKey = JSON.stringify([
      brand.id,
      voice.id,
      voice.enrolledAt ?? voice.createdAt,
      language,
      text,
    ]);
    setSpeaking(true);
    setSpeakError(null);
    try {
      if (speakAudioRef.current) speakAudioRef.current.pause();
      let blob = speakCacheRef.current.get(cacheKey);
      if (!blob) {
        blob = await apiFetchBlob(`/brands/${brand.id}/voice/speak`, {
          method: "POST",
          json: { text, language },
        });
        speakCacheRef.current.set(cacheKey, blob);
        if (speakCacheRef.current.size > 8) {
          const oldest = speakCacheRef.current.keys().next().value;
          if (oldest) speakCacheRef.current.delete(oldest);
        }
      }
      setSavedSpeakKey(cacheKey);
      speakAudioRef.current = playBlob(blob, () => setSpeakPlaying(false));
      setSpeakPlaying(true);
    } catch (e) {
      setSpeakError(
        e instanceof Error ? e.message : "Voice synthesis failed — try again",
      );
    } finally {
      setSpeaking(false);
    }
  };

  const showRecorder = !voice || rerecord;
  const currentSpeakKey = voice && speakText.trim()
    ? JSON.stringify([
        brand.id,
        voice.id,
        voice.enrolledAt ?? voice.createdAt,
        speakLanguage ?? voice.sampleLanguage,
        speakText.trim(),
      ])
    : null;
  const hasSavedSpeakAudio = Boolean(
    currentSpeakKey && savedSpeakKey === currentSpeakKey,
  );

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold">Brand voice</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Record the script once — this brand&apos;s Read Aloud, Read Text and
          hands-free replies then speak in your voice. Runs on your own server.
        </p>
      </div>

      {info.isLoading && (
        <p className="text-xs text-muted-foreground">Loading voice…</p>
      )}

      {voice && !rerecord && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <Badge variant="secondary">{voice.sampleLanguage}</Badge>
          <span className="text-xs text-muted-foreground">
            Saved {new Date(voice.enrolledAt ?? voice.createdAt).toLocaleDateString()}
            {voice.status !== "ready" ? ` · ${voice.status}` : ""}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={playSample}
              disabled={busy === "sample"}
            >
              {busy === "sample" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Hear sample
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRerecord(true)}>
              Re-record
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                del.mutate(brand.id, { onError: (e) => setError(e.message) })
              }
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
      {voice?.lastSynthesisError && !rerecord && (
        <p className="text-xs text-destructive">
          Last voice test failed: {voice.lastSynthesisError}
        </p>
      )}

      {showRecorder && languages.length > 0 && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Language you&apos;ll read in
            </span>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm sm:w-56"
              value={language ?? languages[0] ?? ""}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l === "te" ? "Telugu" : l === "hi" ? "Hindi" : l}
                </option>
              ))}
            </select>
          </label>

          {script.data && (
            <div className="rounded-lg border bg-accent/30 p-3">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                Read this aloud (about 20–30 seconds):
              </p>
              <p className="text-sm leading-relaxed">{script.data.text}</p>
            </div>
          )}

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              This is{" "}
              <select
                className="mx-1 rounded border bg-background px-1 py-0.5"
                value={consentType}
                onChange={(e) =>
                  setConsentType(
                    e.target.value === "authorized_voice"
                      ? "authorized_voice"
                      : "own_voice",
                  )
                }
              >
                <option value="own_voice">my own voice</option>
                <option value="authorized_voice">a voice I&apos;m authorized to clone</option>
              </select>
              and I allow CatGPT to save and use it for this brand&apos;s audio.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <Button
                variant="outline"
                size="sm"
                onClick={startRecording}
                disabled={!consent || save.isPending}
              >
                <Mic className="h-3.5 w-3.5" />
                {voice ? "Record new sample" : "Start recording"}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={stopRecording}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            )}
            {previewUrl && !recording && (
              <>
                {/* Reviewing the take before saving — nothing is uploaded until
                    the button below runs. */}
                <audio src={previewUrl} controls className="h-9" />
                <Button
                  size="sm"
                  onClick={saveVoice}
                  disabled={save.isPending}
                >
                  {save.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {voice ? "Replace voice" : "Save voice"}
                </Button>
              </>
            )}
          </div>
          {!consent && (
            <p className="text-[11px] text-muted-foreground">
              Tick the consent box above to enable recording.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {voice && !rerecord && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-xs font-medium">Read Text — hear this voice</p>
          <Textarea
            rows={3}
            maxLength={MAX_SPEAK_CHARS}
            value={speakText}
            onChange={(e) => setSpeakText(e.target.value)}
            placeholder="Type a message for this brand's voice to read…"
          />
          <div className="flex flex-wrap items-center gap-2">
            {speakLanguages.length > 1 && (
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={speakLanguage ?? voice.sampleLanguage}
                onChange={(e) => setSpeakLanguage(e.target.value)}
              >
                {speakLanguages.map((l) => (
                  <option key={l} value={l}>
                    {l === "te" ? "Telugu" : l === "hi" ? "Hindi" : l === "en" ? "English" : l}
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={speak}
              disabled={speaking || !speakText.trim()}
            >
              {speaking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              {speaking
                ? "Generating…"
                : hasSavedSpeakAudio
                  ? "Play saved audio"
                  : "Speak"}
            </Button>
            {speakPlaying && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => speakAudioRef.current?.pause()}
              >
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            )}
            {hasSavedSpeakAudio && (
              <span className="text-[11px] text-muted-foreground">
                Saved privately for this brand — replay anytime.
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              First CPU generation can take a minute or two; saved repeats play immediately.
            </span>
          </div>
          {speakError && (
            <p className="text-xs text-destructive">{speakError}</p>
          )}
        </div>
      )}
    </section>
  );
}
