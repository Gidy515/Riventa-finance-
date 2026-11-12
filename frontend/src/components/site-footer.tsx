import { siteContent } from "@/content";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-inner">
        <div>
          <p className="footer-brand">{siteContent.brand}</p>
          <p>{siteContent.footer.note}</p>
        </div>
        <p className="footer-disclaimer">{siteContent.footer.disclaimer}</p>
      </div>
    </footer>
  );
}
