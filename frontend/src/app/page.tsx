import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/sections/hero-section";
import { ProblemSection } from "@/components/sections/problem-section";
import { ProcessSection } from "@/components/sections/process-section";
import { MandatesSection } from "@/components/sections/mandates-section";
import { PrivacySection } from "@/components/sections/privacy-section";
import { SafeguardsSection } from "@/components/sections/safeguards-section";
import { StatusSection } from "@/components/sections/status-section";
import { DevelopersSection } from "@/components/sections/developers-section";
import { ClosingSection } from "@/components/sections/closing-section";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroSection />
        <ProblemSection />
        <ProcessSection />
        <MandatesSection />
        <PrivacySection />
        <SafeguardsSection />
        <StatusSection />
        <DevelopersSection />
        <ClosingSection />
      </main>
      <SiteFooter />
    </>
  );
}
