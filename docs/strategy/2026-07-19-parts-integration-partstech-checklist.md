# Parts pricing integration — what it takes

**Date:** 2026-07-19 (corrected)

> **Correction (2026-07-19):** An earlier version of this note said the only
> realistic path was **PartsTech** and that "neither O'Reilly nor RepairLink has
> an open public API you can just sign up for." That was wrong. Both **O'Reilly
> First Call** and **RepairLink** run their own direct integration programs, and
> both are free. The plan below goes **direct to the two suppliers the shop
> actually uses** and treats PartsTech as an optional bundle, not the main route.

**The goal:** a tech picks a part on their job page and the live price from the
shop's **O'Reilly First Call** + **RepairLink/dealer** accounts appears; the
shop's markup turns that cost into the customer price automatically. The tech
never sees a number.

---

## Two doors (we're taking Door A)

**Door A — connect directly to the two suppliers you use (recommended).**
- **O'Reilly First Call** runs an integration program for shop software — 130+
  shop management systems are already connected. We ask O'Reilly to switch it on
  for VynTechs, tied to the shop's First Call account.
- **RepairLink** (OEConnection / OEC — the dealer & OEM parts side) integrates
  directly into shop software the same way it does for ShopMonkey and Tekmetric,
  and **RepairLink Shop is free** for the shop.
- Why this door: it's the exact two tools the shop already knows by name, no
  unfamiliar middleman. Trade-off (ours to carry, not the shop's): two hookups to
  build and maintain instead of one bundled one. Both are free.

**Door B — one aggregator that bundles both (optional, not chosen now).**
- **PartsTech** (owned by OEC) or **Nexpart / WHI** put O'Reilly + the dealers
  behind a single connection. One hookup instead of two, but it adds a middleman
  the shop doesn't currently use. Keep as a fallback if a specific OEM brand turns
  out to be easier through the bundle than direct.

---

## The checklist

### What the shop needs to line up
- [ ] **Have your O'Reilly First Call account number handy** (and a recent
  invoice number — O'Reilly uses it to confirm the account is yours).
- [ ] **Have your dealer / OEM parts account info** for the brands you buy
  through RepairLink.
- [ ] **Confirm your default parts markup is set in the app** — already built
  (Settings → Shop → Rates). This is what turns supplier cost into the customer
  price, so techs never touch money.

### What we (the app) do
- [ ] **Reach O'Reilly to get VynTechs approved as a connected system.**
  Email `integrations@oreillyauto.com` or call **First Call Support
  1-800-934-2451**. Start here — it's the shop's main, everyday parts source and
  the easiest door.
- [ ] **Reach OEConnection for RepairLink** integration for the app. Second, for
  dealer / OEM parts.
- [ ] **Build each connection once approved:** tech searches a part → we call the
  supplier → it returns the shop's live cost + availability → we apply the shop
  markup → it drops onto the quote. Ordering can run through the same connection
  later.
- [ ] **(Optional fallback)** aggregator route via PartsTech partner API —
  `PartsTech-Partner-API@oeconnection.com` — only if a direct hookup proves harder
  for a given brand.

### Honest unknowns (to confirm on the setup call)
- Exact approval steps and timeline on O'Reilly's side (they review the account
  link; it can take a few days).
- Whether every OEM brand the shop uses is reachable direct through RepairLink,
  or whether one or two are easier through an aggregator.

---

## Monday call script (O'Reilly First Call — 1-800-934-2451)

Read this, in your own words:

> "Hi — I'm a First Call customer. We're setting up a shop management software
> called VynTechs, and I want to connect my First Call account so the software
> can pull live pricing and availability and place orders. Who do I talk to about
> getting that integration turned on, and what do you need from me?"

Have ready: your **First Call account number** and a **recent invoice number**.
If they'd rather email, point them to `integrations@oreillyauto.com`. That's the
whole call — you're just asking them to connect the account you already have.

## Email draft (if you'd rather write than call)

**To:** integrations@oreillyauto.com
**Subject:** Shop management software integration — VynTechs

> Hi O'Reilly integrations team,
>
> I'm Brandon Nichols with VynTechs, a shop management software platform for auto
> repair shops. We'd like to integrate O'Reilly First Call ordering and pricing
> into our app so our shops can look up parts, see their First Call account
> pricing and availability, and order — without leaving VynTechs.
>
> How do we get set up as a connected shop management system and request
> integration access? Our shop's First Call account number is `[account #]`.
>
> About us:
> - Product: VynTechs — shop management software
> - Company / legal name: `[business name]`
> - Contact: Brandon Nichols, brandon.james.nichols@gmail.com, `[phone]`
>
> Thanks,
> Brandon Nichols — VynTechs

---

## Meanwhile — the relay we already shipped (no outside dependency)

Because the suppliers aren't wired yet, the tech flags the part they need right on
their job page — **what it is** (e.g. "water pump"), a **brand/source preference**
(dealer, Motorcraft, AC Delco, or a specific supplier), and **how many** — with
**zero money**. That flag relays to the **parts person**, who logs into
RepairLink / First Call on their own, gets the real part and price, and brings it
back onto the quote. When the direct connections are live later, that same flag
becomes an instant live-priced pick with no rework.
