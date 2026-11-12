export const siteContent = {
  brand: "Riventa",
  socialImage: {
    alt: "Riventa — conditional trade settlement",
    eyebrow: "TRADE OPERATIONS · NEAR",
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
    { label: "Agent limits", href: "#agent-limits" },
    { label: "Build status", href: "#build-status" },
    { label: "Developers", href: "#developers" },
  ],
  hero: {
    eyebrow: "TRADE OPERATIONS · NEAR",
    title: "Pay suppliers only when the goods pass inspection.",
    description:
      "Your payment stays in escrow until supplier documents are recorded and an independent inspector confirms the goods passed. An agent can act only within the limits you set.",
    primaryAction: "Watch the demo",
    secondaryAction: "View the code",
    visualLabel: "DOCUMENT RECORD",
    visualNote:
      "A document fingerprint is recorded on NEAR. The document contents are not.",
    authenticityNote:
      "A fingerprint helps verify document integrity. It does not prove authenticity.",
    visualAccessibleLabel:
      "Illustrative commercial invoice with its contents redacted and a 32-byte fingerprint recorded on NEAR.",
    recordStatus: "ON NEAR",
    fingerprintLabel: "ILLUSTRATIVE 32-BYTE FINGERPRINT",
    fingerprintValue:
      "8f2a71c4d90e3b6a5c1f8e2d4a7b9c0e1d3f5a6b8c2e4d7f9a0b1c3e5d6f7a8b",
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
      "A trade has more than a payment. The supplier must accept the terms, documents must be recorded, and an independent inspector must report the goods passed before a payout can be authorized.",
    points: [
      {
        title: "Supplier documents",
        description:
          "Required document fingerprints are recorded against the trade.",
      },
      {
        title: "Independent inspection",
        description:
          "A registered inspector records whether the goods passed or failed.",
      },
      {
        title: "Conditional settlement",
        description:
          "Escrow settlement follows the trade's authorized outcome.",
      },
    ],
  },
  process: {
    eyebrow: "THE TRADE LIFECYCLE",
    title: "From agreement to settlement.",
    description:
      "Each trade follows an explicit sequence recorded by the NEAR smart contract.",
    steps: [
      {
        title: "Buyer creates a trade",
        description:
          "The buyer defines the supplier, payment token, amount and trade terms.",
        actor: "Buyer",
        contractCheck:
          "The trade terms, parties and required parameters are validated.",
      },
      {
        title: "Supplier accepts",
        description: "The supplier accepts the trade.",
        actor: "Supplier",
        contractCheck:
          "The contract verifies the supplier is the party named in the trade.",
      },
      {
        title: "Buyer funds escrow",
        description:
          "The buyer funds escrow using a NEP-141 fungible token.",
        actor: "Buyer",
        contractCheck:
          "The contract records the funded amount as the trade's escrow liability.",
      },
      {
        title: "Supplier records documents",
        description:
          "The required document fingerprints are committed on-chain.",
        actor: "Supplier",
        contractCheck:
          "The contract associates the 32-byte commitments with the trade.",
      },
      {
        title: "Inspector records a result",
        description:
          "The buyer assigns a registered inspector, who records pass or fail.",
        actor: "Registered inspector",
        contractCheck:
          "The contract verifies the inspector is registered and assigned to the trade.",
      },
      {
        title: "Settlement is authorized",
        description:
          "A permitted payout or refund is authorized according to the trade outcome.",
        actor: "Buyer or authorized agent",
        contractCheck:
          "The contract validates the permitted outcome and settlement authority.",
      },
      {
        title: "Payout or refund is sent",
        description:
          "Anyone can trigger the authorized token transfer. A failed transfer can be retried.",
        actor: "Any account",
        contractCheck:
          "The contract tracks the outstanding liability until the transfer succeeds.",
      },
    ],
  },
  mandates: {
    eyebrow: "BUYER-CONTROLLED AUTHORITY",
    title: "An agent can act. It cannot set its own limits.",
    description:
      "The buyer creates a mandate that defines exactly which actions an agent may take. The contract enforces those limits.",
    limits: [
      {
        label: "Approved supplier",
        detail: "The supplier the agent is allowed to trade with.",
      },
      {
        label: "Per-trade cap",
        detail: "The maximum amount for an individual trade.",
      },
      {
        label: "Total budget",
        detail: "The aggregate budget available to the mandate.",
      },
      {
        label: "Expiry",
        detail: "When the mandate stops being valid.",
      },
      {
        label: "Permitted outcomes",
        detail: "Whether the agent may authorize release, refund or both.",
      },
    ],
    protectionTitle: "What the contract enforces",
    protections: [
      "The agent uses its own account.",
      "The agent cannot move the buyer's escrowed funds.",
      "The contract enforces the mandate budget and permissions.",
      "Revocation blocks new agent actions.",
      "Trades already funded keep the rules they started with.",
    ],
  },
  privacy: {
    eyebrow: "DOCUMENT PROVENANCE",
    title: "The document stays off-chain. Its fingerprint is recorded.",
    description:
      "Riventa records a 32-byte cryptographic fingerprint of each supplier document on NEAR. It does not record the document contents.",
    recordedTitle: "Recorded on NEAR",
    recordedItems: [
      "32-byte document fingerprint",
      "Document commitment associated with the trade",
    ],
    notRecordedTitle: "Not recorded on-chain",
    notRecordedItems: [
      "Document contents",
      "The original invoice or shipping file",
    ],
    qualification:
      "A matching fingerprint can show that a document has not changed. It cannot establish that the document is genuine.",
  },
  safeguards: {
    eyebrow: "DEADLINES AND RECOVERY",
    title: "The contract defines when the next action is due.",
    description:
      "If a required deadline is missed, the buyer can take a refund under the contract's timeout rules.",
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
      "Once a payout or refund is authorized, anyone can trigger it. If the token transfer fails, the contract retains the liability and allows a retry.",
    controls: [
      "Administrative actions require approval from 2 of 3 administrators.",
      "The contract has no upgrade method.",
    ],
  },
  status: {
    eyebrow: "CURRENT IMPLEMENTATION",
    title: "What is built. What is planned.",
    description:
      "The contract has been tested locally in a NEAR sandbox. The test token has no monetary value.",
    builtHeading: "Built",
    plannedHeading: "Planned",
    plannedLabel: "Planned",
    note:
      "The contract has been tested locally in a NEAR sandbox. It has not been presented as a production deployment. The test token has no monetary value.",
    built: [
      "Rust smart contract on NEAR",
      "99 automated tests in a local NEAR sandbox",
      "Buyer creates trades, supplier accepts, buyer funds escrow",
      "NEP-141 token escrow",
      "Buyer-controlled agent mandates and contract-enforced budgets",
      "On-chain document fingerprints",
      "Registered inspector pass/fail attestation",
      "Deadline-based refund paths",
      "Retryable settlement after transfer failure",
      "2-of-3 administrator approvals",
      "No contract upgrade method",
    ],
    planned: [
      "Private encrypted document storage",
      "Document text extraction",
      "AI-written explanations of document inconsistencies (advisory only; AI does not authorize money)",
      "Agent worker",
      "Web application",
      "Wallet login",
      "Dispute resolution",
      "Cross-chain funding through NEAR Intents",
      "Production deployment",
    ],
  },
  developers: {
    eyebrow: "FOR BUILDERS",
    title: "A Rust contract with testable trade rules.",
    description:
      "Riventa is built on NEAR with a Rust smart contract. Its local test suite covers the trade lifecycle, mandate enforcement, document commitments, inspection and settlement paths.",
    facts: [
      { label: "Smart contract", value: "Rust · NEAR" },
      { label: "Token standard", value: "NEP-141" },
      { label: "Automated tests", value: "99 · local sandbox" },
      { label: "Document record", value: "32-byte fingerprint" },
    ],
    action: "View the code",
  },
  closing: {
    title: "Payment follows the trade conditions.",
    description:
      "See how escrow, document commitments, inspection and buyer-defined agent limits work together.",
    primaryAction: "Watch the demo",
    secondaryAction: "View the code",
  },
  footer: {
    note: "Confidential trade operations and conditional settlement.",
    disclaimer:
      "Prototype tested locally with a test token that has no monetary value.",
  },
} as const;
