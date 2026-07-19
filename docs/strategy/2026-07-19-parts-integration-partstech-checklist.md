# Parts pricing integration — what it takes (PartsTech)

**Date:** 2026-07-19

**The goal:** a tech picks a part on their job page and the live price from the
shop's **O'Reilly First Call** + **RepairLink/dealer** accounts appears; the
shop's markup turns that cost into the customer price automatically. The tech
never sees a number.

**The one path that covers both** O'Reilly and RepairLink is **PartsTech** — an
aggregator that both plug into (and which is owned by OEC, the maker of
RepairLink, so they're tied together). One connection → live shop-specific cost +
availability + ordering from both O'Reilly and the OEM/dealer parts behind
RepairLink. Backup path: **Nexpart / WHI OrderLink**. Neither O'Reilly nor
RepairLink has an open public API you can just sign up for — the aggregator is
the realistic route.

---

## The checklist (what to knock out before we commit to the real build)

### What the shop (you) needs to line up
- [ ] **A PartsTech account** for the shop.
- [ ] **Link your O'Reilly First Call account to PartsTech.** Needs your O'Reilly
  account number + an invoice number; **O'Reilly manually reviews and approves**
  the link (can take a few days).
- [ ] **Link your dealer / OEM parts accounts** (the ones behind RepairLink) to
  PartsTech.
- [ ] **Confirm your default parts markup is set in the app** — already built
  (Settings → Shop → Rates). This is what turns supplier cost into the customer
  price, so techs never touch money.

### What we (the app) do
- [ ] **Apply to the PartsTech partner API** — email
  `PartsTech-Partner-API@oeconnection.com` and go through their partner
  onboarding/demo. Free to integrate, but it's an application, not self-serve.
  **This is the gating step:** until we're an approved partner, we can't pull
  live prices.
- [ ] **Once approved, build the connection:** tech searches a part → we call
  PartsTech → it returns the shop's live cost + availability from O'Reilly and the
  dealers → we apply the shop markup → it drops onto the quote. Ordering can run
  through the same connection later.

### The honest unknowns (confirmed on the PartsTech onboarding call)
- Exact partner terms, timeline, and any approval conditions.
- Whether every OEM brand you use is covered inside PartsTech. Its OEM coverage is
  real but may be narrower than RepairLink's full dealer network for a few brands;
  the common case is covered, and a direct RepairLink hookup can be added later.

### Bottom line
Yes, it's doable, and PartsTech is the clean single path. Two things gate it:
(1) **us** getting approved as a PartsTech partner, and (2) **you** linking your
O'Reilly + dealer accounts. Neither is a flip of a switch, but both are standard —
many shop apps run on exactly this.

---

## Meanwhile — the relay we're shipping now (no outside dependency)

Because the suppliers aren't wired yet, the tech flags the part they need right on
their job page — **what it is** (e.g. "water pump"), a **brand/source preference**
(dealer, Motorcraft, AC Delco, or a specific supplier), and **how many** — with
**zero money**. That flag relays to the **parts person**, who logs into
RepairLink / First Call on their own, gets the real part and price, and brings it
back onto the quote. When PartsTech is live later, that same flag becomes an
instant live-priced pick with no rework.
