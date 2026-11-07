# 10. AI Document Intelligence

## Runtime
Ollama 0.40.11 local runtime with `qwen3:4b-instruct-2507-q4_K_M` (digest prefix `0edcdef34593`). The model runs within the backend deployment boundary; no hosted LLM provider receives trade documents. If the model runtime is unavailable, deterministic findings remain available and the UI marks narrative explanation unavailable.

## Processing
1. Validate MIME, size and file signature; accept synthetic demo files only and sandbox parsers. No antivirus scanner is included in this prototype.
2. Extract embedded PDF text with `pdfjs-dist 5.4.149`; use `tesseract.js 6.0.1` with English language data for scanned PDFs and PNG/JPEG.
3. Extract typed fields into the versioned schema below.

## Versioned extraction schema (`cocoa-trade-docs.v1`)
- Common: `document_type`, `document_number`, `issue_date`, `issuer_name`, `buyer_name`, `supplier_name`, `commodity`, `quantity_value`, `quantity_unit`, `origin_country`, `destination_country`, `shipment_reference`.
- Commercial invoice: `currency`, `unit_price`, `total_amount`, `incoterm`.
- Packing list: `package_count`, `gross_weight_kg`, `net_weight_kg`, `package_marks`.
- Certificate of origin: `declared_origin_country`, `certificate_number`, `issuing_body_name` (issuer remains unverified).
- Inspection report: `inspection_location`, `inspection_date`, `inspector_account`, `outcome`, `observations`.
- Missing/unreadable values are `null`, never inferred. Preserve raw extracted string, normalized value, page number and extraction confidence for every field.
4. Run deterministic checks for required fields, party names, invoice/PO references, quantity/unit, dates, currency and arithmetic.
5. Compare across invoice, packing list and certificate metadata.
6. Use local model only to explain existing deterministic findings in plain language.
7. Store private report with source file IDs, page references, field evidence, rule/model version and confidence/limitations.

## Non-authority
Model output cannot create a new settlement condition, mark a document fraudulent, authenticate an issuer, change extracted source values, adjudicate disputes or call contract methods. It may not access arbitrary tools. Findings are review leads for humans.

## Agent decision boundary

The local model may interpret a buyer's trade request, summarize approved supplier information, explain deterministic document findings and recommend the next workflow action. It does not determine whether the customer mandate authorizes an operation.

The agent worker converts an approved request or model recommendation into a typed action proposal. A deterministic policy layer checks the mandate projection, trade state, supplier, token, amount, policy version and available budget before preparing a transaction. The NEAR contract independently validates all on-chain authorization conditions.

The model has no signing key, wallet access, arbitrary RPC transaction tool or ability to modify a mandate. It cannot submit an inspector attestation, resolve a dispute, authorize a settlement outside the recorded policy snapshot or bypass a rejected policy check. The backend must not treat model confidence or natural-language output as authorization.

## Prompt injection and hostile input
Document text is untrusted data, never instructions. The model has no wallet, RPC signing key, shell or network tools. Use strict schema output, bounded context, output validation and adversarial tests. Ignore embedded commands and instruction-like content.

## Explainability
Every finding includes category, severity, compared field(s), source documents/page, extracted values, deterministic rule ID and a concise rationale. No opaque fraud score. Arithmetic/date comparisons are code, not LLM inference.
