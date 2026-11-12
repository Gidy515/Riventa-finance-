import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";

export function PrivacySection() {
  const { privacy } = siteContent;

  return (
    <section className="section" id="privacy" aria-labelledby="privacy-title">
      <div className="site-container">
        <div id="privacy-title">
          <SectionHeading
            eyebrow={privacy.eyebrow}
            title={privacy.title}
            description={privacy.description}
          />
        </div>

        <div className="privacy-grid">
          <article className="privacy-panel">
            <h3>{privacy.recordedTitle}</h3>
            <ul className="plain-list">
              {privacy.recordedItems.map((item) => (
                <li key={item}>
                  <span className="list-check" aria-hidden="true">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="privacy-panel not-recorded">
            <h3>{privacy.notRecordedTitle}</h3>
            <ul className="plain-list">
              {privacy.notRecordedItems.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <p className="privacy-qualification">{privacy.qualification}</p>
      </div>
    </section>
  );
}
