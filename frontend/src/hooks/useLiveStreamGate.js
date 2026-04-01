import { useEffect, useRef, useState } from "react";

/**
 * Gate live decoders when the tab is hidden or the tile is off-screen.
 * Reduces CPU/network for dashboard grids and background tabs.
 */
export function useLiveStreamGate(options = {}) {
  const { rootMargin = "120px" } = options;
  const containerRef = useRef(null);
  const [tabVisible, setTabVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );
  // Assume visible until IntersectionObserver reports otherwise (avoids black first frame).
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;

    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) setInView(e.isIntersecting);
      },
      { root: null, rootMargin, threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  const enabled = tabVisible && inView;

  return { containerRef, enabled };
}
