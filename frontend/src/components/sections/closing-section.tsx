import { siteContent } from "@/content";
import { ActionLink } from "@/components/action-link";

export function ClosingSection() {
  const { closing, links } = siteContent;

  return (
    <section
      className="section closing-section"
      id="get-started"
      aria-labelledby="closing-title"
    >
      <div className="site-container closing-panel">
        <div className="closing-copy">
          <p className="eyebrow">{siteContent.brand}</p>
          <h2 id="closing-title">{closing.title}</h2>
          <p>{closing.description}</p>
        </div>

        <div className="closing-actions">
          <ActionLink
            href={links.demo}
            label={closing.primaryAction}
            variant="primary"
          />
          <ActionLink
            href={links.repository}
            label={closing.secondaryAction}
            variant="secondary"
          />
        </div>
      </div>
    </section>
  );
}
