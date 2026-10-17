import { Play } from "lucide-react";
import { isVideoUrl } from "@catgpt/types";
import { cn } from "@/lib/utils";

/**
 * An image, or - for an uploaded Reel - a muted first-frame video with a play
 * badge. Library videos are stored like images (one URL), so this is the one
 * place that decides which element to render.
 */
export function MediaThumb({
  src,
  alt = "",
  className,
  controls = false,
}: {
  src: string;
  alt?: string;
  className?: string;
  /** Full player (viewers); thumbnails stay a static first frame. */
  controls?: boolean;
}) {
  if (!isVideoUrl(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" className={className} />;
  }
  return (
    <>
      <video
        src={controls ? src : `${src}#t=0.1`}
        controls={controls}
        muted={!controls}
        playsInline
        preload="metadata"
        aria-label={alt}
        className={cn(className, !controls && "pointer-events-none")}
      />
      {!controls && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white">
          <Play className="size-3 fill-current" />
        </span>
      )}
    </>
  );
}
