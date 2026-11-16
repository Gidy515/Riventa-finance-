export const siteContent = {
  brand: "Riventa",
  socialImage: {
    alt: "Riventa — conditional trade settlement",
    eyebrow: "CROSS BORDER TRADE OPERATIONS · NEAR",
    footerLeft: "Confidential trade operations",
    footerRight: "Conditional settlement",
  },
  menuLabel: "Menu",
  accessibility: {
    desktopNavigation: "Main navigation",
    mobileNavigation: "Mobile navigation",
  },
  invoice: {
    title: "COMMERCIAL INVOICE",
    reference: "DOCUMENT / 001",
    supplier: "SUPPLIER",
    documentReference: "REFERENCE",
    goods: "GOODS",
    amount: "AMOUNT",
    contents: "DOCUMENT CONTENTS",
    redacted: "REDACTED",
  },
  description:
    "Trade payments held in escrow until supplier documents are recorded and an independent inspector confirms the goods passed.",
  links: {
    demo: process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "",
    repository:
      process.env.NEXT_PUBLIC_REPOSITORY_URL ??
      "https://github.com/Gidy515/Riventa-finance-",
  },
  navigation: [
    { label: "How it works", href: "#how-it-works" },
    { label: "Assistant permissions", href: "#agent-limits" },
    { label: "Progress", href: "#build-status" },
    { label: "About Riventa", href: "#developers" },
    { label: "Get started", href: "/workspace" },
  ],
  hero: {
    eyebrow: "CROSS BORDER TRADE OPERATIONS · NEAR",
    title: "Confidence for buyers. Certainty for suppliers.",
    description:
      "Agree on trade terms, verify delivery independently, and manage payments through a transparent process designed to give buyers confidence and suppliers greater payment certainty. Every action remains within the agreed terms.",
    primaryAction: "Watch the demo",
    secondaryAction: "Explore the project",
    visualLabel: "DOCUMENT VERIFICATION",
    visualNote:
      "A document check is recorded on NEAR. The private document itself stays private.",
    authenticityNote:
      "This record helps show whether a document has changed. It does not prove that the document is genuine.",
    visualAccessibleLabel:
      "Illustrative commercial invoice with private details hidden and a verification record saved on NEAR.",
    recordStatus: "ON NEAR",
    fingerprintLabel: "ILLUSTRATIVE DOCUMENT CHECK",
    fingerprintValue:
      "RVT-DOC-001-VERIFIED-2026",
    sequenceLabel: "Trade settlement conditions",
    sequence: [
      "Payment held",
      "Documents recorded",
      "Inspection passed",
    ],
  },
  problem: {
    eyebrow: "THE TRADE CONDITION",
    title: "Payment and verification belong to the same process.",
    description:
      "A trade involves more than payment. The supplier must accept the terms, required documents must be checked, and an independent inspector must confirm the goods passed before payment is released.",
    points: [
      {
        title: "Supplier documents",
        description:
          "Document checks help confirm that required files have not been changed.",
      },
      {
        title: "Independent inspection",
        description:
          "An independent inspector records whether the goods passed or failed.",
      },
      {
        title: "Conditional settlement",
        description:
          "Payment is released or returned according to the agreed trade outcome.",
      },
    ],
  },
  process: {
    eyebrow: "THE TRADE LIFECYCLE",
    title: "From agreement to settlement.",
    description:
      "Each trade follows clear steps, with the agreed rules securely recorded on NEAR.",
    steps: [
      {
        title: "Buyer creates a trade",
        description:
          "The buyer sets the supplier, payment amount and agreed trade terms.",
        actor: "Buyer",
        contractCheck:
          "The agreed terms and the people involved are checked before the trade begins.",
      },
      {
        title: "Supplier accepts",
        description: "The supplier accepts the trade.",
        actor: "Supplier",
        contractCheck:
          "The supplier is checked against the name agreed by the buyer.",
      },
      {
        title: "Buyer protects the payment",
        description:
          "The buyer places the agreed payment in a protected holding account.",
        actor: "Buyer",
        contractCheck:
          "The payment amount is recorded and held until the agreed conditions are met.",
      },
      {
        title: "Supplier records documents",
        description:
          "The supplier submits the required trade documents and a verification record is saved.",
        actor: "Supplier",
        contractCheck:
          "The verification records are linked to the correct trade.",
      },
      {
        title: "Inspector records a result",
        description:
          "The buyer appoints an approved inspector, who records whether the goods pass or fail.",
        actor: "Registered inspector",
        contractCheck:
          "The inspector is checked to ensure they are approved for this trade.",
      },
      {
        title: "Settlement is authorized",
        description:
          "A permitted payout or refund is authorized according to the trade outcome.",
        actor: "Buyer or approved assistant",
        contractCheck:
          "The requested payment or refund is checked against the agreed trade conditions.",
      },
      {
        title: "Payout or refund is sent",
        description:
          "The approved payment or refund can then be sent. If a transfer fails, it can be tried again.",
        actor: "Any account",
        contractCheck:
          "The payment remains recorded until the transfer is successful.",
      },
    ],
  },
  mandates: {
    eyebrow: "BUYER-CONTROLLED PERMISSIONS",
    title: "An assistant can act. The buyer sets its limits.",
    description:
      "The buyer sets clear permissions and spending limits for an assistant. Riventa checks that every proposed action stays within those limits.",
    limits: [
      {
        label: "Approved supplier",
        detail: "The supplier the assistant is allowed to trade with.",
      },
      {
        label: "Maximum per trade",
        detail: "The maximum amount for an individual trade.",
      },
      {
        label: "Total budget",
        detail: "The total amount available for approved trades.",
      },
      {
        label: "Expiry",
        detail: "When the assistant’s permission expires.",
      },
      {
        label: "Permitted outcomes",
        detail: "Whether the assistant may approve payment, a refund or both.",
      },
    ],
    protectionTitle: "How the buyer stays in control",
    protections: [
      "The assistant acts through its own account.",
      "The assistant cannot move the buyer's protected funds on its own.",
      "Spending limits and permissions are checked before an action is allowed.",
      "The buyer can withdraw permission and stop new actions.",
      "Trades that are already funded keep the rules agreed at the start.",
    ],
  },
  privacy: {
    eyebrow: "DOCUMENT CONFIDENCE",
    title: "Private documents stay private. Their verification records are saved.",
    description:
      "Riventa saves a unique verification record for each supplier document on NEAR, without putting the document itself on the public record.",
    recordedTitle: "Recorded on NEAR",
    recordedItems: [
      "A unique record showing that the document was checked",
      "A link between the record and its trade",
    ],
    notRecordedTitle: "Kept private",
    notRecordedItems: [
      "Document contents",
      "The original invoice or shipping file",
    ],
    qualification:
      "A matching record can help show that a document has not changed. It cannot prove that the document is genuine.",
  },
  safeguards: {
    eyebrow: "DEADLINES AND RECOVERY",
    title: "Clear deadlines keep every trade moving.",
    description:
      "If an agreed deadline is missed, the buyer can request a refund under the trade rules.",
    deadlines: [
      {
        period: "7 days",
        event: "Supplier documents after funding",
      },
      {
        period: "3 days",
        event: "Inspector assignment after documents are complete",
      },
      {
        period: "7 days",
        event: "Inspection result after assignment",
      },
    ],
    settlementTitle: "Settlement does not disappear when a transfer fails.",
    settlementDescription:
      "Once a payment or refund is approved, it can be sent. If the transfer fails, the funds remain accounted for and the transfer can be retried.",
    controls: [
      "Important administrative actions require approval from at least two of three administrators.",
      "The trade rules cannot be quietly changed after deployment.",
    ],
  },
  status: {
    eyebrow: "CURRENT PROGRESS",
    title: "What is built. What is under development.",
    description:
      "Riventa has been tested in a NEAR sandbox using a demo stablecoin. This is not real USDC and has no monetary value.",
    builtHeading: "Built",
    plannedHeading: "Under development",
    plannedLabel: "Under development",
    note:
      "Riventa has been tested in a NEAR sandbox. This is a prototype, not a live production service. It uses a demo stablecoin, not real USDC or funds with monetary value.",
    built: [
      "NEAR smart contract for managing trade agreements and protected payments",
      "99 automated checks in a NEAR test environment",
      "Buyer creates trades, supplier accepts, buyer funds escrow",
      "Protected holding of digital payments until trade conditions are met",
      "Buyer-controlled assistant permissions and spending limits",
      "Document verification records saved on NEAR",
      "Independent inspector records whether goods pass or fail",
      "Refunds when agreed deadlines are missed",
      "Ability to retry a payment if a transfer fails",
      "Important changes require approval from two of three administrators",
      "Trade rules designed to remain consistent after launch",
    ],
    planned: [
      "Secure private storage for trade documents",
      "Automatic reading of key details from trade documents",
      "AI-assisted explanations of possible document inconsistencies",
      "Automated assistance for trade workflows",
      "A complete online workspace for buyers and suppliers",
      "Simpler account connection and sign-in",
      "Dispute resolution",
      "Support for stablecoins such as USDC in live payment environments",
      "Public launch",
    ],
  },
  developers: {
    eyebrow: "BUILT AROUND TRADE",
    title: "A clearer way to manage trade commitments.",
    description:
      "Riventa brings buyers, suppliers and independent inspectors into one process. Agreed terms, protected payments, document checks and clear decisions work together so everyone knows what must happen next.",
    facts: [
      { label: "For buyers", value: "Greater payment confidence" },
      { label: "For suppliers", value: "Clearer payment conditions" },
      { label: "For inspectors", value: "A defined role in verification" },
      { label: "Trade records", value: "Important decisions recorded on NEAR" },
    ],
    action: "Get started",
  },
  closing: {
    title: "Payment follows the trade conditions.",
    description:
      "See how protected payments, document checks, independent inspections and buyer-defined permissions work together.",
    primaryAction: "Watch the demo",
    secondaryAction: "Explore the project",
  },
  footer: {
    note: "Confidential trade operations and conditional settlement.",
    disclaimer:
      "Prototype tested in a NEAR sandbox using a demo stablecoin, not real USDC or funds with monetary value.",
  },
} as const;
