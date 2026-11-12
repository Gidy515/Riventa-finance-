import { siteContent } from "@/content";
import { SectionHeading } from "@/components/section-heading";

export function ProblemSection() {
  const { problem } = siteContent;

  return (
    <section className="section" aria-labelledby="problem-title">
      <div className="site-container">
        <div id="problem-title">
          <SectionHeading
            eyebrow={problem.eyebrow}
            title={problem.title}
            description={problem.description}
          />
        </div>

        <div className="problem-grid">
          {problem.points.map((point) => (
            <article className="problem-item" key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
