# 1. Project Overview

## Identity
**Riventa — Confidential Trade Operations and Conditional Settlement for Businesses** Category: AI-assisted trade operations and conditional-settlement infrastructure.

## Canonical description
Riventa helps buyers and suppliers coordinate confidential cross-border transactions through structured agreements, encrypted document handling, AI-assisted documentary review, independent milestone attestation and conditional settlement on NEAR. The contract enforces agreed state transitions and escrow rules; off-chain services process private documents and provide operational support.

## MVP scenario
A fictional Lagos-based Nigerian buyer purchases 1,000 kg of bagged cocoa beans from a fictional Tema-based Ghanaian supplier. An independent inspector performs a pre-dispatch inspection at Tema. The trade uses exactly 10,000 project-issued SDD units (6 decimals) through a NEP-141 test token with no monetary value. This is a controlled software demonstration, not a real shipment or validated market pilot.

## Direct actors
- Buyer/importer: creates the trade, funds escrow, submits buyer-side actions and makes acceptance/refund/dispute choices.
- Supplier/exporter: accepts the agreed terms and submits supplier-side documents.
- Inspector: admin-registered, buyer-assigned, submits one final pass/fail attestation.
- Resolver: mutually agreed before funding and decides disputes.

## Boundaries
Riventa is not a bank, lender, insurer, customs authority, carrier, issuer-authentication oracle, legal service or autonomous payment agent. It does not establish legal identity from wallet control. AI flags potential inconsistencies; hashes bind bytes; inspectors attest to observations. None independently proves fraud or truth.
