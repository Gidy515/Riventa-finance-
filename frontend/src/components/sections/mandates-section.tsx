import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";
import { AgentSimulatorLoader } from "@/components/sections/agent-simulator-loader";

export function MandatesSection() {
  const { mandates } = siteContent;

  return (
    <section
      className="section"
      id="agent-limits"
      aria-labelledby="mandates-title"
    >
      <div className="site-container">
        <div id="mandates-title">
          <SectionHeading
            eyebrow={mandates.eyebrow}
            title={mandates.title}
            description={mandates.description}
          />
        </div>

        <div className="mandate-grid">
          <div className="mandate-list">
            {mandates.limits.map((limit) => (
              <article className="mandate-item" key={limit.label}>
                <h3>{limit.label}</h3>
                <p>{limit.detail}</p>
              </article>
            ))}
          </div>

          <aside className="protection-panel">
            <h3>{mandates.protectionTitle}</h3>
            <ul className="protection-list">
              {mandates.protections.map((protection) => (
                <li key={protection}>
                  <span className="list-check" aria-hidden="true">✓</span>
                  <span>{protection}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <AgentSimulatorLoader />
      </div>
    </section>
  );
}
