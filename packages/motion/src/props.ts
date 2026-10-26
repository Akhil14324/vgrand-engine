/**
 * Props for one motion clip. Lives apart from the React component so the API
 * can type its calls without loading any JSX.
 */
export interface MotionClipProps {
  /** card: fills the frame (titles, CTAs). caption: transparent, lower third, for footage. */
  mode: "card" | "caption";
  text: string;
  sub: string | null;
  background: string;
  color: string;
  accent: string;
  durationFrames: number;
  width: number;
  height: number;
}
