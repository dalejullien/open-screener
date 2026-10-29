import { useEffect, useMemo, useState } from "react";

interface Props {
  card: HTMLCanvasElement;
  text: string;
  fileName: string;
  onClose: () => void;
}

const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error("no image"))), "image/png"));

/**
 * X's post link can only pre-fill text, so the chart travels via the clipboard:
 * copy the image, open the draft, paste (⌘V / Ctrl+V). Download is the fallback.
 */
export function ShareDialog({ card, text: initial, fileName, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const preview = useMemo(() => card.toDataURL("image/png"), [card]);
  const mac = navigator.platform.toLowerCase().includes("mac");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyAndOpen = async () => {
    // Open the draft first so the popup isn't blocked, then copy within the same click.
    const draft = window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank");
    try {
      // Passing a promise keeps Safari's user-gesture requirement satisfied.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(card) })]);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    draft?.focus();
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = preview;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Share on X</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <img className="share-preview" src={preview} alt="Chart card preview" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
        <div className="modal-actions">
          <button className="btn primary" onClick={copyAndOpen}>
            Copy chart & open X
          </button>
          <button className="btn" onClick={download}>
            Download PNG
          </button>
          <span className="small muted">
            {copied === "ok"
              ? `✓ Chart copied — click into the X post and press ${mac ? "⌘V" : "Ctrl+V"} to attach it.`
              : copied === "failed"
                ? "Your browser blocked copying images — use Download PNG and attach it."
                : "X can't receive images from a link, so the chart goes via your clipboard."}
          </span>
        </div>
      </div>
    </div>
  );
}
