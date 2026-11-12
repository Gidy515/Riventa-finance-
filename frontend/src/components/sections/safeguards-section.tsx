import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";

export function SafeguardsSection() {
  const { safeguards } = siteContent;

  return (
    <section
      className="section"
      id="safeguards"
      aria-labelledby="safeguards-title"
    >
      <div className="site-container">
        <div id="safeguards-title">
          <SectionHeading
            eyebrow={safeguards.eyebrow}
            title={safeguards.title}
            description={safeguards.description}
          />
        </div>

        <div className="deadline-list">
          {safeguards.deadlines.map((deadline) => (
            <div className="deadline-row" key={deadline.event}>
              <span className="deadline-period">{deadline.period}</span>
              <span className="deadline-event">{deadline.event}</span>
            </div>
          ))}
        </div>

        <article className="settlement-note">
          <h3>{safeguards.settlementTitle}</h3>
          <p>{safeguards.settlementDescription}</p>
          <ul className="plain-list">
            {safeguards.controls.map((control) => (
              <li key={control}>
                <span className="list-check" aria-hidden="true">✓</span>
                <span>{control}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
