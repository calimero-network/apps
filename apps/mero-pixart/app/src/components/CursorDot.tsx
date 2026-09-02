import { useEffect, useRef } from "react";

// Local pointer dot that smoothly lerp-follows the mouse. Decorative; the editor
// can mount it to give the cursor a branded feel.
export default function CursorDot() {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let tx = -100, ty = -100;
    let cx = -100, cy = -100;

    function onMove(e: MouseEvent) {
      tx = e.clientX;
      ty = e.clientY;
    }

    function loop() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${cx}px, ${cy}px)`;
      }
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={dotRef}
      style={{
        position: "fixed",
        top: -4,
        left: -4,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--accent, #A5FF11)",
        pointerEvents: "none",
        zIndex: 9999,
        willChange: "transform",
      }}
    />
  );
}
