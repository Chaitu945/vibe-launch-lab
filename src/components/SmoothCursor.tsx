import { useEffect, useRef } from "react";

/**
 * A soft cursor trail: a small dot that tracks the pointer exactly and a ring that
 * lags behind it (lerped), growing over anything clickable.
 *
 * Deliberately NOT a replacement for the native cursor: hiding the real pointer is
 * a usability tax, and a lagging ring is the part that actually feels nice.
 *
 * Disabled for touch pointers and for `prefers-reduced-motion`, and it is pure
 * decoration: `pointer-events: none`, no layout, transform-only updates on a rAF loop
 * that is cancelled on unmount.
 */
export function SmoothCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    if (reduce || coarse) return;
    // rAF exists in every browser that matters, but a headless DOM may not expose it.
    // Falling back to a timer keeps the component mountable anywhere.
    const requestFrame: (cb: FrameRequestCallback) => number =
      typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(() => cb(0), 16) as unknown as number;
    const cancelFrame: (h: number) => void =
      typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (h) => clearTimeout(h);

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let scale = 1;
    let targetScale = 1;
    let visible = false;
    let raf = 0;
    const root = document.documentElement;

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      const el = e.target as HTMLElement | null;
      const interactive = !!el?.closest("button, a, input, select, .tr.clickable, .chip");
      targetScale = interactive ? 1.9 : 1;
      if (!visible) {
        visible = true;
        root.classList.add("cursor-live");
      }
    };
    const onLeave = () => {
      visible = false;
      root.classList.remove("cursor-live");
    };

    const loop = () => {
      ringX += (x - ringX) * 0.16;
      ringY += (y - ringY) * 0.16;
      scale += (targetScale - scale) * 0.18;
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) scale(${scale.toFixed(3)})`;
      raf = requestFrame(loop);
    };

    raf = requestFrame(loop);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      root.classList.remove("cursor-live");
    };
  }, []);

  return (
    <>
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
    </>
  );
}
