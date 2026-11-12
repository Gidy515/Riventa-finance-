"use client";

import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { siteContent } from "@/content";

const invoiceFields = [
  { label: "SUPPLIER", value: "Northstar Components" },
  { label: "REFERENCE", value: "INV-2026-014" },
  { label: "GOODS", value: "Industrial components" },
  { label: "AMOUNT", value: "USD 15,000" },
];

export function InvoiceFingerprint() {
  const { hero, invoice } = siteContent;
  const [playback, setPlayback] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="hero-visual-wrap">
      <div
        key={playback}
        className="hero-visual"
        data-playback={playback}
        data-reduced-motion={prefersReducedMotion ? "true" : "false"}
        role="img"
        aria-label={hero.visualAccessibleLabel}
      >
        <div className="document-sheet">
          <div className="document-topline">
            <span className="document-label">{invoice.title}</span>
            <span className="document-ref">{invoice.reference}</span>
          </div>

          <div className="document-rule" />

          <div className="document-grid">
            {invoiceFields.map((field, index) => (
              <div className="document-field" key={field.label}>
                <span className="document-field-label">{field.label}</span>
                <span
                  className="invoice-value"
                  style={{ animationDelay: `${0.68 + index * 0.14}s` }}
                >
                  {field.value}
                </span>
                <span
                  className="redaction-mask"
                  style={{ animationDelay: `${0.68 + index * 0.14}s` }}
                  aria-hidden="true"
                />
              </div>
            ))}
          </div>

          <div className="document-lines" aria-hidden="true">
            <span className="document-line" />
            <span className="document-line" />
            <span className="document-line" />
          </div>

          <div className="document-footer">
            <span>{invoice.contents}</span>
            <span>{invoice.redacted}</span>
          </div>

          <span className="document-scan-line" aria-hidden="true" />
        </div>

        <div className="record-panel">
          <div className="fingerprint-heading">
            <span>{hero.visualLabel}</span>
            <span className="record-check">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="m3 8.2 3.1 3.1L13 4.7"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {hero.recordStatus}
            </span>
          </div>

          <p className="fingerprint-label">{hero.fingerprintLabel}</p>

          <p className="fingerprint-value" aria-label={hero.fingerprintValue}>
            {Array.from(hero.fingerprintValue).map((character, index) => (
              <span
                className="fingerprint-char"
                key={`${index}-${character}`}
                style={{ animationDelay: `${1.42 + index * 0.014}s` }}
                aria-hidden="true"
              >
                {character}
              </span>
            ))}
          </p>

          <div className="ledger-record">
            <span className="ledger-indicator" aria-hidden="true" />
            <span>Commitment recorded on NEAR</span>
            <span className="ledger-tag">ILLUSTRATIVE</span>
          </div>
        </div>

        <p className="hero-visual-note">{hero.visualNote}</p>
        <p className="hero-qualification">{hero.authenticityNote}</p>
      </div>

      <button
        className="sequence-replay"
        type="button"
        onClick={() => setPlayback((current) => current + 1)}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13 5.5A5.5 5.5 0 1 0 13.3 9M13 2.5v3.5H9.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Replay sequence
      </button>
    </div>
  );
}
