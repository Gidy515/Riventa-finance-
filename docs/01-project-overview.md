# 1. Project Overview

## Identity
**Riventa — Confidential Trade Operations and Conditional Settlement for Businesses** Category: autonomous trade-operations business.

## Canonical description
Riventa is an autonomous trade-operations business. Its agent coordinates approved cross-border procurement and trade workflows under customer-signed execution mandates. It can create permitted trades, coordinate encrypted document handling and documentary review, arrange eligible inspection and initiate pre-authorized settlement actions. Customers retain control of their funds and mandate settings; suppliers accept trade terms; inspectors attest to observations; and the NEAR contract enforces agent authority, trade state transitions, budget limits and escrow rules. AI interprets requests and explains findings but does not authorize financial actions.

## MVP scenario
A fictional Lagos-based Nigerian buyer purchases 1,000 kg of bagged cocoa beans from a fictional Tema-based Ghanaian supplier. An independent inspector performs a pre-dispatch inspection at Tema. The trade uses exactly 10,000 project-issued SDD units (6 decimals) through a NEP-141 test token with no monetary value. This is a controlled software demonstration, not a real shipment or validated market pilot.

## Direct actors
- Buyer/importer: creates and controls the execution mandate, remains the trade buyer, funds escrow and retains the rights reserved by the mandate and trade rules.
- Riventa agent: acts through its own NEAR account, creates trades within active mandates and executes only permitted contract actions.
- Supplier/exporter: accepts the agreed terms and submits supplier-side documents.
- Inspector: admin-registered, buyer-assigned, submits one final pass/fail attestation.
- Resolver: mutually agreed before funding and decides disputes.

## Boundaries
Riventa is not a bank, lender, insurer, customs authority, carrier, issuer-authentication oracle or legal service. It does not establish legal identity from wallet control. Its agent is an autonomous trade-operations operator, not an unrestricted customer-wallet custodian. AI flags potential inconsistencies; hashes bind bytes; inspectors attest to observations. None independently proves fraud, issuer authenticity, document truth or physical delivery. Customer escrow is separate from Riventa's operating treasury.
