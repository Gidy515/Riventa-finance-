"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const AgentSimulator = dynamic(
  () => import("./agent-simulator").then((module) => module.AgentSimulator),
  {
    ssr: false,
    loading: () => (
      <div className="simulator-loading" aria-label="Loading simulator">
        Loading the mandate simulator…
      </div>
    ),
  },
);

export function AgentSimulatorLoader() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      {shouldLoad ? (
        <AgentSimulator />
      ) : (
        <div className="simulator-loading">
          The interactive mandate simulator loads when it comes into view.
        </div>
      )}
    </div>
  );
}
