# License plate → vehicle lookup: what to buy, what it costs, what it risks

Research date: 2026-07-30. Nothing was purchased and no account was created.

---

## The recommendation

**Use PlateToVIN, "Business" plan. About $58/month at 200 lookups, about $94/month at 600.**
$40/month base plus $0.09 per plate lookup. Self-serve signup, no contract, cancel any time.
Repeat lookups of the same plate within 7 days are free.

Two conditions on that recommendation:

1. **Test before you pay.** PlateToVIN gives 5 free lookups. Run 5 real trucks out of your own
   lot — one older Super Duty, one recently-bought unit, one out-of-state plate — and see if the
   answers come back right. If 5 of 5 aren't correct, don't spend the money.
2. **Never let it write up the truck by itself.** The plate result gets shown to the advisor as
   "is this the truck in front of you? 2014 Ford F-350, white" and the advisor has to say yes.
   Silent auto-fill is how you invoice the wrong vehicle.

**Honest size of the win:** small. It replaces typing 17 VIN characters with typing 7, on
first-visit vehicles only. At 200 lookups a month, that is roughly 100 minutes of advisor time
saved — the subscription costs about what the time is worth. The real gain is fewer typos and
fewer walks out to the lot, not a big money number. It is worth doing because your advisors asked
for it, not because the math is compelling.

---

## Comparison

| Provider | Price | Cost at 200/mo | Cost at 600/mo | Self-serve? | Says DPPA in writing? | Names its data source? |
|---|---|---|---|---|---|---|
| **PlateToVIN — Business** | $40/mo + $0.09/lookup | **$58** | **$94** | Yes | **Yes** — terms require you to attest to a §2721(b) purpose | No — "third-party sources" |
| VehicleRegistrationAPI | $0.20/lookup, 100 minimum | $40 | $120 | Yes (10 free test lookups) | **No** | Vague — "official government data sources" |
| CarAPI | Credit packs, $0.40 down to $0.25/lookup | ~$60–70 | ~$150 | Yes | **No** | No |
| Vehicle Databases | Not published | unverified | unverified | 15 free credits on signup | **No** | No |
| CarsXE | Not published on the public page | unverified | unverified | unverified | **No** | No |
| Auto.dev | Plate lookup is locked to the $599/mo "Scale" plan, then $0.055/lookup | **$610** | **$632** | Yes, but the $599 is unavoidable | **No** | Claims "direct DMV-partner data" |

**What all of them return:** the 17-character VIN plus year, make, model, and usually trim, body
style, engine, fuel type, drivetrain, transmission and color. That is the same information your
free NHTSA decode already gives you — the only thing you're buying is the ability to start from a
plate instead of a VIN.

**Why not the cheapest one.** VehicleRegistrationAPI is $18/month cheaper at your volume and says
nothing at all about the Driver's Privacy Protection Act or where its data comes from. That silence
is the finding. Eighteen dollars a month is not worth signing up for a data feed whose legal basis
nobody will put in writing.

**Why not Auto.dev.** Their plate lookup is technically the cheapest per call, but they gate it
behind a $599/month plan. At your volume that is roughly ten times the PlateToVIN price for the
same answer.

**Coverage.** Every vendor claims all 50 states plus DC. Auto.dev is the only one that admits in
its own docs that coverage has "varying coverage levels by region" without saying which regions.
Nobody publishes a per-state hit rate. Treat "all 50 states" as a marketing claim, not a guarantee.

---

## The legal part, in plain English

There is a federal law — the Driver's Privacy Protection Act, 18 U.S.C. §2721 — that controls what
comes out of state DMV records. Here is the distinction that matters for you:

**The law protects the person, not the truck.** The law's own definition of protected "personal
information" is a list: photograph, Social Security number, driver's license number, name, address,
phone number, medical information. A VIN is not on that list. Neither is year, make, model, or
color. So a lookup that answers "what vehicle wears this plate" is asking for information the
statute does not protect, while a lookup that answers "who owns this plate" is squarely inside it.
Buy the first kind. Never buy the second kind.

**But you still have to say why you're asking.** The vendors do not sell this on the theory that
vehicle description is unregulated — they sell it on the theory that you have a permissible purpose
under §2721(b). PlateToVIN's terms make you promise, in writing, that you "will only use the
Service for purposes expressly permitted under DPPA § 2721(b), such as vehicle safety, theft,
emissions, recalls, or other lawful investigative purposes."

**What you would actually be agreeing to.** Signing up for PlateToVIN means you are representing
that (a) every lookup is for one of those permitted purposes, (b) you will keep records you could
show someone if asked, (c) you will keep your API key secure, and (d) you will never use the data
for credit checks, employment screening, or tenant screening. For a repair shop, "motor vehicle
safety," "motor vehicle emissions," and "product alterations, recalls, or advisories" are the
categories that fit — you are looking up a vehicle that is physically in your bay in order to
repair it. A defensible practice is: only look up a plate on a vehicle actually present at your
shop, and log the ticket number alongside the lookup.

**The gap you should know about.** Texas has its own layer on top of the federal law — TxDMV runs
an authorized-requester program and contracts directly with motor-vehicle-related businesses for
data access. None of these API vendors explain whether their Texas data comes through that program
or somewhere else. PlateToVIN's own terms say only that records "originate from third-party sources
that may contain errors or be incomplete." **No vendor reviewed here discloses its actual data
source.** That is a real finding, not a footnote: you are relying on the vendor's representation,
and the contractual protection you get is their promise plus your own attestation — nothing more.

**This is not legal advice.** If you want certainty rather than a defensible practice, that is a
30-minute question for a Texas attorney.

---

## What goes wrong

Plate lookups fail in specific, predictable ways. Every one of these is a reason the advisor —
not the software — has to confirm the vehicle.

- **Recently sold truck.** State records lag. Texas HB 718 (effective 2025-07-01) ended paper tags
  and put dealer-issued metal plates on newly sold vehicles, but title and registration activity
  "may take a few weeks to populate fully in state and federal databases." A truck bought last week
  will very likely miss, or return nothing.
- **Transferred plate.** In many states an owner moves their plate to a new vehicle. Until the
  record updates, the lookup returns the *old* vehicle. This is the dangerous failure — it returns
  a confident, wrong answer instead of an error.
- **Dealer plates and temporary tags.** These generally are not tied to a specific VIN at all.
  Expect a miss.
- **Out-of-state plate.** Works in principle, but you must supply the correct state. An advisor who
  assumes "TX" on an Oklahoma truck gets either nothing or the wrong vehicle.
- **Auction and dealer units.** As you said yourself — these have no plate. VIN entry stays the
  path for them, so plate lookup will never cover 100% of first-visit vehicles.
- **Vanity and specialty plates.** Supported by the vendors, but format handling varies.

**Nobody publishes a hit rate.** Not one of these vendors states what percentage of lookups
succeed or how often a result is stale. The industry's own framing is that plate lookups are
"moderate" accuracy versus VIN decoding's "high" accuracy. **I could not verify a real-world hit
rate for any provider.** Your 5-lookup free test will tell you more than any marketing page.

---

## What you already have

- **Free VIN decode.** `lib/intake/decode-vin.ts` calls NHTSA's vPIC service, no cost, no contract,
  no privacy law involved. It fills year/make/model/engine and the advisor is already told to
  "verify each vehicle field before creating the ticket."
- **Plate search on returning vehicles.** Already works. The plate is stored on the vehicle record
  and `lib/intake/search.ts` searches it alongside VIN, make, model and owner name. A returning
  truck is already findable by plate today, for free.
- **A plate field at the counter.** The write-up screen already has a "License plate" box.

So the paid lookup fills exactly one hole: **a first-visit vehicle that has a plate.** Not returning
vehicles (already covered, free). Not auction or dealer units (no plate to type). One narrow slice.

A useful side effect: today the plate field is only populated if the advisor bothers to type it. A
plate lookup fills it automatically for new vehicles, which makes your free returning-vehicle plate
search work better over time. That is a genuine compounding benefit and part of why this clears the
bar.

**One thing to budget for that isn't on any pricing page:** wiring this into the write-up screen —
the plate box, the state selector, the confirm step, the error handling — is more work than the
subscription costs. The subscription is the cheap part.

---

## Sources

All fetched 2026-07-30.

- PlateToVIN pricing — https://platetovin.com/plans
- PlateToVIN API detail and state coverage — https://platetovin.com/license-plate-to-vin-api
- PlateToVIN terms (DPPA attestation, accuracy disclaimer) — https://platetovin.com/terms
- Auto.dev pricing (Scale plan, $0.055 plate call) — https://www.auto.dev/pricing
- Auto.dev plate-to-VIN docs (fields, error cases, regional coverage caveat) — https://docs.auto.dev/v2/api-reference/plate-to-vin
- CarAPI license plate pricing (credit packs) — https://carapi.app/pricing/license-plate
- VehicleRegistrationAPI ($0.20/lookup, 100 minimum, 10 free test lookups) — https://www.vehicleregistrationapi.com/
- Vehicle Databases license plate API (fields, 15 free credits, no published price) — https://vehicledatabases.com/api/license-plate
- CarsXE plate decoder docs — https://docs.carsxe.com/plate-decoder-v2
- 18 U.S.C. §2721, permissible uses — https://www.law.cornell.edu/uscode/text/18/2721
- Definition of "personal information," 18 U.S.C. §2725 — https://epic.org/dppa/
- TxDMV Driver's Privacy Protection Act page (Texas authorized-requester program) — https://www.txdmv.gov/site-policies/drivers-privacy-protection-act
- Texas HB 718 metal-plate transition and database lag — https://www.txdmv.gov/sites/default/files/body-files/Texas_License_Plates_Law_Enforcement_Guide.pdf

### Explicitly unverified

- Vehicle Databases and CarsXE per-lookup prices — not published publicly; both require contacting them.
- Real-world hit rate or miss rate for any provider — none publish one.
- Which states, if any, have degraded coverage — Auto.dev admits variation but names no states; the others claim uniform 50-state coverage with no evidence.
- Every vendor's actual upstream data source — none disclose it.
- Whether any of these vendors is a TxDMV authorized requester — not stated by any of them.
- RapidAPI/Zyla marketplace reseller pricing — the pricing page would not load; marketplace resellers also add a layer between you and an already-undisclosed data source, so it is not recommended regardless.
