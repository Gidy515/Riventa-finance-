import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";

export function StatusSection() {
  const { status } = siteContent;

  return (
    <section
      className="section"
      id="build-status"
      aria-labelledby="status-title"
    >
      <div className="site-container">
        <div id="status-title">
          <SectionHeading
            eyebrow={status.eyebrow}
            title={status.title}
            description={status.description}
          />
        </div>

        <div className="status-grid">
          <div className="status-column">
            <h3>{status.builtHeading}</h3>
            <ul className="status-list">
              {status.built.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="status-column planned">
            <h3>{status.plannedHeading}</h3>
            <ul className="status-list">
              {status.planned.map((item) => (
                <li key={item}>
                  <span>
                    {item}
                    <span className="planned-label">{status.plannedLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="status-note">{status.note}</p>
      </div>
    </section>
  );
}
