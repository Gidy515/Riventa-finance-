import { siteContent } from "@/content";
import { ActionLink } from "@/components/action-link";
import { SectionHeading } from "@/components/section-heading";

export function DevelopersSection() {
  const { developers, links } = siteContent;

  return (
    <section
      className="section"
      id="developers"
      aria-labelledby="developers-title"
    >
      <div className="site-container developer-grid">
        <div id="developers-title">
          <SectionHeading
            eyebrow={developers.eyebrow}
            title={developers.title}
            description={developers.description}
          />
          <div className="developer-action">
            <ActionLink
              href={links.repository}
              label={developers.action}
              variant="secondary"
            />
          </div>
        </div>

        <dl className="developer-facts">
          {developers.facts.map((fact) => (
            <div className="developer-fact" key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
