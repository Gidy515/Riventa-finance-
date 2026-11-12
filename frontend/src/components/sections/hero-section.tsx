import { siteContent } from "@/content";
import { ActionLink } from "@/components/action-link";
import { InvoiceFingerprint } from "@/components/visuals/invoice-fingerprint";

export function HeroSection() {
  const { hero, links } = siteContent;

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="site-container">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{hero.eyebrow}</p>
            <h1 id="hero-title">{hero.title}</h1>
            <p className="hero-description">{hero.description}</p>

            <div className="hero-actions">
              <ActionLink href={links.demo} label={hero.primaryAction} />
              <ActionLink
                href={links.repository}
                label={hero.secondaryAction}
                variant="secondary"
              />
            </div>

            <div className="hero-sequence" aria-label={hero.sequenceLabel}>
              {hero.sequence.map((item) => (
                <span key={item}>
                  <i className="sequence-dot" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <InvoiceFingerprint />
        </div>
      </div>
    </section>
  );
}
