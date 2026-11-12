"use client";

import { useEffect, useRef, useState } from "react";
import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";

export function ProcessSection() {
  const { process, safeguards } = siteContent;
  const [activeStep, setActiveStep] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const items = Array.from(
      list.querySelectorAll<HTMLElement>("[data-process-step]"),
    );

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const index = Number(
            (visible.target as HTMLElement).dataset.processStep,
          );
          if (Number.isInteger(index)) setActiveStep(index);
        }
      },
      {
        rootMargin: "-25% 0px -45% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const currentStep = process.steps[activeStep] ?? process.steps[0];

  return (
    <section
      className="section"
      id="how-it-works"
      aria-labelledby="process-title"
    >
      <div className="site-container">
        <div id="process-title">
          <SectionHeading
            eyebrow={process.eyebrow}
            title={process.title}
            description={process.description}
          />
        </div>

        <div className="process-layout">
          <div className="process-list" ref={listRef}>
            {process.steps.map((step, index) => (
              <article
                className={`process-step${activeStep === index ? " is-active" : ""}`}
                data-process-step={index}
                key={step.title}
              >
                <span className="step-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="process-step-copy">
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  <span className="process-mobile-meta">
                    <strong>Actor:</strong> {step.actor}
                  </span>
                  <span className="process-mobile-meta">
                    <strong>Contract check:</strong> {step.contractCheck}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <aside className="process-detail" aria-live="polite">
            <span className="process-detail-label">
              STEP {String(activeStep + 1).padStart(2, "0")} /{" "}
              {String(process.steps.length).padStart(2, "0")}
            </span>
            <h3>{currentStep.title}</h3>
            <div className="process-detail-block">
              <span>WHO ACTS</span>
              <p>{currentStep.actor}</p>
            </div>
            <div className="process-detail-block">
              <span>WHAT THE CONTRACT CHECKS</span>
              <p>{currentStep.contractCheck}</p>
            </div>
          </aside>
        </div>

        <div className="deadline-strip">
          <div className="deadline-heading">
            <span className="eyebrow">CONTRACT DEADLINES</span>
            <p>Time limits between required actions.</p>
          </div>
          <div className="deadline-items">
            {safeguards.deadlines.map((deadline) => (
              <div
                className="deadline-item"
                key={`${deadline.period}-${deadline.event}`}
              >
                <strong>{deadline.period}</strong>
                <span>{deadline.event}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
