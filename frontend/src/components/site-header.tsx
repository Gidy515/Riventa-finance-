import { siteContent } from "@/content";
import { ActionLink } from "@/components/action-link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <a className="wordmark" href="/" aria-label={siteContent.brand}>
          {siteContent.brand}
        </a>

        <nav
          className="desktop-nav"
          aria-label={siteContent.accessibility.desktopNavigation}
        >
          {siteContent.navigation.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-action">
          <ActionLink
            href={siteContent.links.demo}
            label={siteContent.hero.primaryAction}
          />
        </div>

        <details className="mobile-menu">
          <summary>{siteContent.menuLabel}</summary>
          <nav aria-label={siteContent.accessibility.mobileNavigation}>
            {siteContent.navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
