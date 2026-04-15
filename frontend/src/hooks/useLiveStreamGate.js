import { useEffect, useRef, useState } from "react";

/**
 * Browsers limit parallel HTTP/1.1 connections per host (~6). Each dashboard tile loads
 * go2rtc stream.html (MSE/WebSocket) against the same origin, so many visible tiles can
 * exceed the limit — extra tiles often show go2rtc's "MSE: stream not found" even when
 * the stream exists. When maxConcurrentLiveDecoders is set, we cap concurrent decoders.
 */
let _liveDecoderSlotsInUse = 0;
const _liveDecoderWaitQueue = [];

function _drainLiveDecoderWaitQueue(max) {
  while (_liveDecoderWaitQueue.length > 0 && _liveDecoderSlotsInUse < max) {
    const cb = _liveDecoderWaitQueue.shift();
    _liveDecoderSlotsInUse += 1;
    cb();
  }
}

/**
 * Gate live decoders when the tab is hidden or the tile is off-screen.
 * Optionally cap concurrent decoders (dashboard grid) to avoid browser per-host limits.
 */
export function useLiveStreamGate(options = {}) {
  const { rootMargin = "120px", maxConcurrentLiveDecoders } = options;
  const containerRef = useRef(null);
  const [tabVisible, setTabVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );
  const [inView, setInView] = useState(true);
  const [slotGranted, setSlotGranted] = useState(maxConcurrentLiveDecoders == null);
  const heldSlotRef = useRef(false);
  const waiterRef = useRef(null);

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

  const want = tabVisible && inView;

  useEffect(() => {
    const max = maxConcurrentLiveDecoders;
    if (max == null) {
      setSlotGranted(true);
      return undefined;
    }

    const release = () => {
      if (!heldSlotRef.current) return;
      heldSlotRef.current = false;
      _liveDecoderSlotsInUse = Math.max(0, _liveDecoderSlotsInUse - 1);
      _drainLiveDecoderWaitQueue(max);
    };

    if (!want) {
      if (waiterRef.current) {
        const idx = _liveDecoderWaitQueue.indexOf(waiterRef.current);
        if (idx >= 0) _liveDecoderWaitQueue.splice(idx, 1);
        waiterRef.current = null;
      }
      release();
      setSlotGranted(false);
      return undefined;
    }

    const grant = () => {
      heldSlotRef.current = true;
      setSlotGranted(true);
    };

    if (_liveDecoderSlotsInUse < max) {
      _liveDecoderSlotsInUse += 1;
      grant();
      return () => {
        release();
        setSlotGranted(false);
      };
    }

    const waiter = () => {
      grant();
    };
    waiterRef.current = waiter;
    setSlotGranted(false);
    _liveDecoderWaitQueue.push(waiter);

    return () => {
      if (waiterRef.current) {
        const idx = _liveDecoderWaitQueue.indexOf(waiterRef.current);
        if (idx >= 0) _liveDecoderWaitQueue.splice(idx, 1);
        waiterRef.current = null;
      }
      release();
      setSlotGranted(false);
    };
  }, [want, maxConcurrentLiveDecoders]);

  const enabled = want && slotGranted;

  return { containerRef, enabled };
}
