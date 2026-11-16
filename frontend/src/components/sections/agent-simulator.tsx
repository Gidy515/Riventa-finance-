"use client";

import { useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";

type Reservation = {
  id: number;
  amount: number;
  supplier: string;
  status: "reserved" | "consumed";
};

const initialSupplier = "Northstar Components";
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

export function AgentSimulator() {
  const [budget, setBudget] = useState("50000");
  const [cap, setCap] = useState("15000");
  const [approvedSupplier, setApprovedSupplier] = useState(initialSupplier);
  const [proposedSupplier, setProposedSupplier] = useState(initialSupplier);
  const [amount, setAmount] = useState("12000");
  const [expired, setExpired] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [result, setResult] = useState(
    "Set the assistant’s permissions, then see whether it can propose a trade.",
  );
  const [nextId, setNextId] = useState(1);
  const reducedMotion = useReducedMotion();

  const totals = useMemo(() => {
    const reserved = reservations
      .filter((item) => item.status === "reserved")
      .reduce((sum, item) => sum + item.amount, 0);

    const consumed = reservations
      .filter((item) => item.status === "consumed")
      .reduce((sum, item) => sum + item.amount, 0);

    return { reserved, consumed, committed: reserved + consumed };
  }, [reservations]);

  const totalBudget = Math.max(0, Number(budget) || 0);
  const free = Math.max(0, totalBudget - totals.committed);
  const shortfall = Math.max(0, totals.committed - totalBudget);
  const safeBudget = totalBudget || 1;

  const reservedWidth = Math.min(
    100,
    (totals.reserved / safeBudget) * 100,
  );
  const consumedWidth = Math.min(
    100 - reservedWidth,
    (totals.consumed / safeBudget) * 100,
  );
  const freeWidth = Math.max(0, 100 - reservedWidth - consumedWidth);

  function proposeTrade() {
    const proposedAmount = Number(amount);
    const currentBudget = Number(budget);
    const tradeCap = Number(cap);
    const supplier = proposedSupplier.trim();
    const approved = approvedSupplier.trim();

    if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
      setResult("Please enter a trade amount greater than zero.");
      return;
    }

    if (!Number.isFinite(currentBudget) || currentBudget <= 0) {
      setResult("Not allowed: the spending limit must be greater than zero.");
      return;
    }

    if (!Number.isFinite(tradeCap) || tradeCap <= 0) {
      setResult("Please set a maximum per trade greater than zero.");
      return;
    }

    if (!approved || !supplier || supplier.toLowerCase() !== approved.toLowerCase()) {
      setResult(
        "Not allowed: this supplier has not been approved by the buyer.",
      );
      return;
    }

    if (expired) {
      setResult(
        "Not allowed: this permission has expired. The assistant cannot propose a new trade.",
      );
      return;
    }

    if (proposedAmount > tradeCap) {
      setResult(
        `Not allowed: ${money(proposedAmount)} is above the maximum of ${money(tradeCap)} for one trade.`,
      );
      return;
    }

    if (totals.committed + proposedAmount > currentBudget) {
      setResult(
        `Not allowed: this trade would exceed the total spending limit. ${money(totals.committed)} is already committed.`,
      );
      return;
    }

    setReservations((current) => [
      ...current,
      {
        id: nextId,
        amount: proposedAmount,
        supplier,
        status: "reserved",
      },
    ]);
    setNextId((current) => current + 1);
    setResult(
      `Accepted: ${money(proposedAmount)} set aside for ${supplier}. The buyer must approve the payment.`,
    );
  }

  function fundReservation(id: number) {
    const reservation = reservations.find((item) => item.id === id);
    if (!reservation || reservation.status !== "reserved") return;

    setReservations((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "consumed" } : item,
      ),
    );
    setResult(
      `The buyer approved the ${money(reservation.amount)} payment for ${reservation.supplier}.`,
    );
  }

  return (
    <section
      className="simulator"
      aria-labelledby="simulator-title"
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <div className="simulator-heading">
        <div>
          <span className="eyebrow">TRY THE RULES</span>
          <h3 id="simulator-title">Assistant permissions preview</h3>
          <p>
            Change the permissions, submit a proposed trade and see how Riventa
            constraints affect the result.
          </p>
        </div>
        <span className="simulation-label">Simulation · Not live</span>
      </div>

      <div className="simulator-grid">
        <div className="simulator-controls">
          <label className="simulator-field">
            <span>Total spending limit</span>
            <span className="simulator-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                type="number"
                min="1"
                step="100"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </span>
          </label>

          <label className="simulator-field">
            <span>Maximum per trade</span>
            <span className="simulator-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                type="number"
                min="1"
                step="100"
                value={cap}
                onChange={(event) => setCap(event.target.value)}
              />
            </span>
          </label>

          <label className="simulator-field">
            <span>Approved supplier</span>
            <input
              type="text"
              value={approvedSupplier}
              onChange={(event) => setApprovedSupplier(event.target.value)}
            />
          </label>

          <label className="simulator-field">
            <span>Proposed supplier</span>
            <input
              type="text"
              value={proposedSupplier}
              onChange={(event) => setProposedSupplier(event.target.value)}
            />
          </label>

          <label className="simulator-field">
            <span>Proposed trade amount</span>
            <span className="simulator-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                type="number"
                min="1"
                step="100"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </span>
          </label>

          <label className="simulator-expiry">
            <input
              type="checkbox"
              checked={expired}
              onChange={(event) => setExpired(event.target.checked)}
            />
            <span>Permission has expired</span>
          </label>

          <button
            className="button button-primary simulator-submit"
            type="button"
            onClick={proposeTrade}
          >
            Assistant proposes a trade of {amount || "0"} with{" "}
            {proposedSupplier.trim() || "this supplier"}
          </button>
        </div>

        <div className="simulator-results">
          <div className="budget-summary">
            <span className="eyebrow">TOTAL SPENDING LIMIT</span>
            <strong>${money(totalBudget)}</strong>
          </div>

          <div
            className="budget-bar"
            role="img"
            aria-label={`Budget allocation: ${money(totals.consumed)} spent, ${money(totals.reserved)} reserved, ${money(free)} free.`}
          >
            <span
              className="budget-segment consumed"
              style={{ width: `${consumedWidth}%` }}
            />
            <span
              className="budget-segment reserved"
              style={{ width: `${reservedWidth}%` }}
            />
            <span
              className="budget-segment free"
              style={{ width: `${freeWidth}%` }}
            />
          </div>

          <div className="budget-legend">
            <div>
              <span className="legend-dot consumed-dot" />
              <span>Spent</span>
              <strong>${money(totals.consumed)}</strong>
            </div>
            <div>
              <span className="legend-dot reserved-dot" />
              <span>Set aside</span>
              <strong>${money(totals.reserved)}</strong>
            </div>
            <div>
              <span className="legend-dot free-dot" />
              <span>Free</span>
              <strong>${money(free)}</strong>
            </div>
          </div>

          {shortfall > 0 && (
            <p className="simulator-warning">
              Existing commitments exceed the edited budget by ${money(shortfall)}.
              New proposals will not be accepted until the spending limit covers them.
            </p>
          )}

          <p className="budget-invariant">
            Your limit must cover both reserved and spent amounts
          </p>

          <div className="simulator-result" aria-live="polite" aria-atomic="true">
            <span className="eyebrow">LATEST RESULT</span>
            <p>{result}</p>
          </div>

          <div className="reservation-list">
            <h4>Accepted proposals</h4>
            {reservations.length === 0 ? (
              <p className="reservation-empty">No proposals accepted yet.</p>
            ) : (
              reservations.map((reservation) => (
                <div className="reservation-row" key={reservation.id}>
                  <div>
                    <strong>${money(reservation.amount)}</strong>
                    <span>{reservation.supplier}</span>
                    <small>
                      {reservation.status === "reserved"
                        ? "Awaiting buyer approval"
                        : "Paid by buyer"}
                    </small>
                  </div>
                  {reservation.status === "reserved" && (
                    <button
                      className="button button-secondary fund-button"
                      type="button"
                      onClick={() => fundReservation(reservation.id)}
                    >
                      Buyer approves payment
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="simulator-disclaimer">
            The assistant can propose trades within its permissions; it cannot move the
            buyer&apos;s funds. Only the buyer approves and releases the payment.
          </p>
        </div>
      </div>
    </section>
  );
}
