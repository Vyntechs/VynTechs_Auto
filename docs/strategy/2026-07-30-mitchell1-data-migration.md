# Getting Young Motorsports off Mitchell 1 TeamWorks SE

Research date: 2026-07-30
Subject install: Manager SE `9.2.1.5356`, user `DEFAULTUSER`, Windows laptop, 67 open ROs on the W.I.P. screen.
Status: research only. Nothing was installed, connected to, or run against the shop's machine.

**Evidence labels used throughout:**

- **[VERIFIED]** — I fetched the primary source myself and read the actual text (including two PDFs I decompressed locally).
- **[VENDOR CLAIM]** — a company saying what its own product does. True until tested; not proof.
- **[ANECDOTE]** — shop owner / forum / review content.
- **[SEARCH-EXTRACT]** — the search engine quoted a page I could not fetch directly (Mitchell 1's own forum and several `buymitchell1.net` pages sit behind Cloudflare bot protection that blocked every fetch route I tried). Weaker than VERIFIED. Flagged everywhere it appears.
- **[UNKNOWN]** — I could not establish it. Listed in §6 rather than guessed.

---

## 1. The answer in five sentences

Yes, the data gets out, and it gets out cleanly — Manager SE stores everything in a **Microsoft SQL Server database named `ShopMgt`** running on the shop's own PC, and Mitchell 1's own knowledge base publishes step-by-step instructions for connecting to it over ODBC and pulling tables into Excel, which means every customer, vehicle, repair order, line item, and RO number is directly queryable by us with no permission, no export request, and no cooperation from Mitchell 1. The second, equally viable route is the product's built-in **Configuration → Special Maintenance → Database Backup**, which writes a standard SQL Server `.bak` file the shop owner already has the right to make — this is literally the file that Tekmetric and Identifix ask their incoming customers to hand over, so it is a proven, industry-standard extraction. Cost is therefore near zero in dollars (competitors charge **$750** for exactly this) and the real cost is our engineering time writing the field mapping, which is days not weeks once we can see the schema. Fidelity is the honest catch: every commercial migration in this market drops **open/active repair orders and A/R balances** and does not carry history into reporting — we can beat all of them because we own the target schema and can read the source directly, but that is work we have to choose to do rather than a switch we flip. My recommendation is a three-pass migration that moves customers + vehicles + closed RO history first, hand-carries the 67 open ROs second, and preserves the original Mitchell RO numbers as a permanent immutable field with our new sequence seeded to `max+1` — with the Mitchell 1 subscription left running until the shop has independently verified the migrated data.

---

## 2. What Manager SE actually is under the hood

### 2.1 The database engine: Microsoft SQL Server — confirmed from Mitchell 1's own documentation

This is the single most important finding, and it is not an inference. Mitchell 1's public knowledge base article **"SE Using Custom Data Export Option"** ([kb.mitchell1.com/articles/id-200](https://kb.mitchell1.com/articles/id-200/)) states on its face that it "explains how to export data from **the SQL database** to Microsoft Excel," and links a PDF, [`sql_excel_6.x.pdf`](https://kb.mitchell1.com/wp-content/uploads/2020/11/sql_excel_6.x.pdf). I downloaded that PDF and decompressed its text. It reads, verbatim: **[VERIFIED]**

> **Part 1: Configuring Manager SE as a Data Source**
> 1. Go to Control Panel, Performance & Maintenance. Select Administration Tools. Then double-click on Data Sources (ODBC).
> 2. User DSN tab opened; click on Add to create a new entry for **Manager SE SQL database**.
> 3. Select **SQL Server** as type, click Finish. (**DO NOT use SQL Native Client**)
> 4. Fill in Name, Description and Server (PCname\database in droplist). Click Next.
> …
> 6. Check the box for default database and select **ShopMgt** from droplist. Click Next.
> …
> 8. Click on Test Data Source.
> 9. Results should be successful. Click OK.
>
> **Part 2: Selecting Manager SE database as Data Source from Excel**
> 1. Select Data menu, choose Import External Data, then New Database Query
> 2. In Choose Data Source, select Manager SE and click OK.
> 3. In Query Wizard, **scroll to desired tables/columns (i.e. Customers, EmailAddress etc)**

So: the engine is **Microsoft SQL Server**, the database is named **`ShopMgt`**, it accepts a **standard ODBC connection using the plain "SQL Server" driver**, and its tables and columns are enumerable by any ODBC client. Mitchell 1 published this themselves.

Two important caveats on this document, stated plainly: it is titled "Shop Management SE 6.x" and its screenshots are Windows XP-era. It is Mitchell 1's current published guidance (still live on their KB, re-uploaded 2020) but it documents the 6.x generation, not 9.2 specifically. See §6 for how cheaply that gets confirmed.

**Independent corroboration.** A third-party integrator, Value Added Services, publishes install instructions for its Data Transfer App that name the same objects for the same product line ([valueaddedonline.com](https://valueaddedonline.com/DataTransferApps/Instructions%20on%20Data%20Transfer%20App%20Installation.htm)): **[VERIFIED]**

> Mitchell1 Shop Key — `C:\Program Files (x86)\M1-SK\Teamworks\Manager\Data` — `ShopMgt` — `<servername>\SHOPSTREAM`

…and instructs the installer to find the server name via **Help → About Manager → "Core Database Path"**, giving `PBS-PC\SHOPSTREAM` as the worked example, noting applicability to "Mitchell 1 6.4 or later." Note the path contains **`Teamworks`** — matching the shop's product name exactly — and `SHOPSTREAM` is the named SQL Server instance. ("ShopStream" is also Mitchell 1's own name for the SE-generation integration platform, which is what the "SE" in Manager SE refers to.)

Mitchell 1's own marketing history says the SQL move happened in 2009 with the rebrand to "SE" ([mitchell1.com press release, 20th anniversary](https://mitchell1.com/press/mitchell-1-manager-marks-20th-anniversary-with-major-enhancements-to-streamline-workflow)) **[SEARCH-EXTRACT]** — consistent with everything above.

**On the Sybase/Advantage hypothesis in the brief: it is wrong for Manager SE.** Advantage Database Server was the engine behind an older generation of DOS/Clipper-era shop products; nothing I found ties it to Manager SE, and Mitchell 1's own ODBC instructions explicitly say to pick the **SQL Server** driver. Treat the Advantage lead as closed.

### 2.2 Where it lives on disk and how it's architected **[VERIFIED]**

From the current Manager SE 9.x installation guide, which I downloaded from Mitchell 1 and extracted ([SE65GettingStartedGuide.pdf](https://mitchell1.com/wp-content/uploads/2025/01/SE65GettingStartedGuide.pdf)):

> "The **HOST/SERVER** button installs both **database engine** and workstation. The database stores **Customer Data, Vehicle, Repair Order History, etc.** The workstation software allows you to interact with the database."
> "The **WORKSTATION** button only installs workstation software for other computers connected to your Server. The workstation software is **your window into the database**."

Architecture constraints from the same document, all of which matter for our cutover planning:

- Windows 10 22H2 64-bit or Windows 11 only. **"Windows Server platforms (Server 2016, 2019, 2022) are not supported. Virtual environments or Windows emulation are also unsupported."**
- **"Active Directory/Domain environments are not supported; only peer-to-peer workgroups."** / "Network domains are not supported."
- Only one host per local network; the KB adds that ARM/Apple Silicon is unsupported ([kb.mitchell1.com/articles/id-1521](https://kb.mitchell1.com/articles/id-1521/)) **[VERIFIED]**.
- The install guide never once names the database engine, a port, a service name, or a data directory. Mitchell 1 does not advertise what is under the hood — but they don't hide it either, since the KB export article gives it away.

Relevant paths (from the sources above and search extraction of Mitchell 1's help pages):

| Thing | Path | Confidence |
|---|---|---|
| Program + data root | `C:\Program Files (x86)\M1-SK\Teamworks\Manager\Data` | **[VERIFIED]** (Value Added Services) |
| SQL instance | `<HOSTNAME>\SHOPSTREAM`, database `ShopMgt` | **[VERIFIED]** (Mitchell 1 KB + Value Added Services) |
| Automatic backups | `C:\ProgramData\M1-SK\Backup` | **[SEARCH-EXTRACT]** (Manager Forum) |
| Mail-merge / CSV exports | `C:\ProgramData\M1-SK\MailMerge\`, default `Followup.csv` | **[VERIFIED]** ([kb id-321](https://kb.mitchell1.com/articles/id-321/)) |
| Legacy restore folder | `C:\mitchell1\manager\series1\mdb` | **[SEARCH-EXTRACT]**, and probably pre-SE — do not rely on it |

### 2.3 Is it readable, or locked?

**Readable.** Three separate lines of evidence say so:

1. Mitchell 1 publishes ODBC connection instructions for it and expects the shop to succeed ("Results should be successful") **[VERIFIED]**.
2. A whole ecosystem of third-party apps — Value Added Services' Data Transfer App, BOLT ON Technology (whose products Mitchell 1 licensed and rebranded in 2011, per [Wikipedia](https://en.wikipedia.org/wiki/Bolt_On_Technology)), Autologue ePart, telematics and CRM integrations — installs on the shop PC and reads that local database. That ecosystem could not exist if the database were sealed.
3. Competing SMS vendors accept the raw Manager SE backup file as their migration input (§4) — they are restoring and reading it.

**What I could not confirm:** whether connecting requires a SQL login whose password Mitchell 1 controls, or whether local Windows administrator rights are sufficient. Mitchell 1's own instructions don't set credentials at all (they leave the ODBC auth page alone: "Do not change anything in this window; click Next"), which strongly implies **Windows authentication as a local admin just works** — SQL Server grants `BUILTIN\Administrators` sysadmin by default. Strongly implied, not proven. This is the cheapest thing in the world to test (§6).

### 2.4 One fidelity landmine to know now

Photos and digital inspections created in **Mobile Manager / BOLT ON** are reportedly **not** captured by Mitchell 1's MSEC backup system — shops report losing them across a restore **[ANECDOTE / SEARCH-EXTRACT]**, surfaced via the [Manager Forum](https://managerforum.buymitchell1.net/viewtopic.php?t=13028). If the shop has inspection photos it cares about, they may live outside `ShopMgt` and need a separate file-level sweep.

---

## 3. Export paths ranked, best to worst

### #1 — Direct ODBC / SQL read of the live `ShopMgt` database **(recommended primary)**

- **Carries:** everything. Every table, every column, full RO line detail — labor lines, parts lines, hours, rates, totals, tax, tech assignment, promised times, A/R, the RO numbers themselves, open and closed alike.
- **Drops:** nothing in the database. May drop BOLT ON photos if those live outside it (§2.4).
- **How:** ODBC DSN to `<HOSTNAME>\SHOPSTREAM`, database `ShopMgt`, plain "SQL Server" driver — exactly as Mitchell 1 documents. Then `SELECT` whatever we want, on our schedule, repeatedly, non-destructively.
- **Cost:** zero dollars. Needs physical/remote access to the host laptop and an hour.
- **Why it's #1:** it is the only path that gives us the **67 open ROs**, and it is re-runnable — we can do a dry run today, a second dry run next week, and a final delta pull the night of cutover.
- **Risk:** read-only queries against a live SQL Server are low-risk, but run them when the shop is closed and never write. If access needs SQL credentials we don't have, fall back to #2.

### #2 — The product's built-in Database Backup (`.bak`) **(recommended safety net, do this first regardless)**

- **Path:** `Configuration → Special Maintenance → Database Backup` (renamed in later builds to "Database Backup and Validations"), Browse → save to Desktop → **Exit and Backup** → exit Manager SE fully; the file is written on exit. This is the exact sequence Tekmetric publishes to its incoming customers ([support.tekmetric.com — How to Pull Mitchell 1 Data](https://support.tekmetric.com/hc/en-us/articles/4406023720343-How-to-Pull-Mitchell-1-Data)) **[VERIFIED]** and the one Identifix publishes too ([Identifix — Data Migration Upload Steps](https://support.shopmanager.identifix.com/support/solutions/articles/43000720957-data-migration-upload-steps)) **[VERIFIED]**, which describes the Mitchell input as a **"Raw database backup"** taken via *"Configuration > Special Maintenance > Data Base Backup and Validation"*.
- **Carries:** the whole database, as a SQL Server `.bak`. Restore it into any SQL Server (Express is free) and it becomes path #1 offline, with zero risk to the shop's live machine.
- **Drops:** nothing in the DB; same photo caveat.
- **Cost:** zero. Ten minutes of the owner's time.
- **File naming (search-extracted, unverified):** files like `2017-06-08M1SK.bak` (overnight auto-backup) and `ThursdayShopMgtDatabaseBackup.bak` (on program exit), sometimes zipped, defaulting to `C:\ProgramData\M1-SK\Backup`. Mitchell 1's own help notes backups can be scheduled at Program Startup, Program Exit, or End of Day **[SEARCH-EXTRACT]**.
- **Do this first.** It costs nothing, it's the owner's own routine feature, and it gives us a frozen artifact to develop against without touching the shop's production machine again.

### #3 — `MM – Create Data Export File` (built-in CSV export) **[VERIFIED]**

Mitchell 1 KB article [id-321](https://kb.mitchell1.com/articles/id-321/): `Reports → Follow Up → MM – Create Data Export File` → set output to Screen → filter across the tabs → Search → Print → save.

- **Carries:** a customer/vehicle follow-up dataset. Filterable by "Service Date, Category, Vehicle, Zip Codes, Mileage, New Customer, Inactive, Recommendations, Inspections."
- **Drops:** RO line detail, financials, A/R, open orders. This is a marketing/mail-merge extract, not an accounting extract.
- **Format:** "csv (comma separated values) only," default `C:\ProgramData\M1-SK\MailMerge\Followup.csv` — **warning: reusing the default filename overwrites the previous export.**
- **Use it as:** a cheap independent cross-check on customer and vehicle counts. If our SQL pull says 4,182 customers and this CSV says 4,182, we have two agreeing witnesses.

### #4 — Report exports to Excel ("XLS Data Only")

Manager SE ships 180+ reports; from print preview you can change the output option to **"XLS Data Only"**, which shop owners describe as the cleanest export format **[ANECDOTE / SEARCH-EXTRACT]** (Manager Forum "Export report data to excel," "Exporting to Excel"). Mitchell 1's own [Manager SE Reports](https://kb.mitchell1.com/wp-content/uploads/2020/12/Manager-SE-Reports.pdf) training deck confirms "Print Preview includes Export options for rendered data" but does not enumerate formats **[VERIFIED]**.

- **Carries:** whatever a given report shows — A/R aging, posted orders (10 variants), cash receipts, technician commission, inventory, customers & vehicles.
- **Drops:** relational structure. A report is a rendered view; you lose the keys that tie a line to an RO to a vehicle to a customer.
- **Use it as:** the **reconciliation layer**. Pull the A/R aging report and the posted-orders totals as of a fixed date, then prove our migrated database produces identical numbers. This is how the owner will actually be convinced.

### #5 — Ask Mitchell 1 for an extract

**[UNKNOWN]** — I found no published data-extract service, no fee schedule, and no shop-owner account of successfully requesting one. Their EULA ([Terms & Conditions](https://mitchell1.com/ordering-terms-and-conditions/)) reserves ownership of *the Products and Services*, not of the shop's operational records, and says nothing public about exit data. Not worth waiting on. Treat as a courtesy call, not a plan.

### #6 — Re-typing

The fallback for the 67 open ROs if — and only if — path #1 proves inaccessible. Every commercial competitor's answer *is* this (§4). Ours shouldn't be.

---

## 4. The competitor / vendor channel — who does this, and how

The headline: **every competitor solves this by asking the shop for the shop's own Manager SE database backup.** None of them negotiate with Mitchell 1. None of them have an API. There is no gatekeeper to get past.

| Vendor | Price | Technical method | What they claim carries | What they say drops |
|---|---|---|---|---|
| **Tekmetric** | **$750** flat, additional migrations $750 each | Shop runs `Configuration → Special Maintenance → Database Backup`, uploads the file to Tekmetric's *Data Migration Upload Tool* under Shop Settings → Integrations | Not enumerated field-by-field anywhere public | **"Active Repair Orders will not be copied from Mitchell1 into Tekmetric. ROs not posted at the time of extraction will need to be manually re-entered."** Also: *"Tekmetric reports will not be populated with the historical data from Mitchell1."* Also: special-character formatting causes "some records to be excluded." Also: **"Tekmetric will not correct any data migration errors 30 days post migration."** |
| **The Back Office** (866-964-9699) | bundled into the $750 | **The named third-party conversion house.** Tekmetric: *"data extraction and conversion will be completed by our third-party data conversion experts, The Back Office."* Also runs Tekmetric's Accounting Link. | Varies by source system; Tekmetric maintains an internal "full vs. standard migration" list | not published |
| **Identifix Shop Manager** | not published | Takes Mitchell's **"Raw database backup"** from Special Maintenance; other systems by `.bak`, `.pak`, FTP with legacy credentials, or CSV | *"Customers, Vehicle, Technicians, Sales History, Inventory, Vendors"*; "150+ shop management systems"; 1–3 business days | **Explicit and damning:** *"Estimates, Open Work Orders, Recommendations or Revisions (unsold work), Accounts Receivable, Canned Jobs or Kits (service templates), Vehicle color or production date"* are **not** converted |
| **Shopmonkey** | not published | Either sends export instructions, **or "opens a remote connection and pulls out what we need directly"** from the shop's PC | "customer data, invoices and more"; 1hr extract / 1–2 days transform / 1hr load | not published |
| **AutoLeap** | setup fees "vary"; not published | not disclosed | customers, vehicles, service history, past invoices, inventory | not published |
| **NAPA TRACS** | not published | assigns a "Data Conversion Specialist" | "customer, vehicle, inventory and history database from other systems" | not published |
| **GEM-CAR** (866-848-8282) | "call for details" | not disclosed | 100+ systems incl. Mitchell1/ShopKey; "customer, vehicle, vehicle history" | entries annotated *"(Dependent on Export)"* |
| **GreaseGoose** | free (vendor blog) | shop exports customers + vehicles as CSV; they import | customers and vehicles only | everything else |

Sources: [Tekmetric Mitchell1 Data Migration](https://support.tekmetric.com/hc/en-us/articles/360041811413-Mitchell1-Data-Migration), [How to Pull Mitchell 1 Data](https://support.tekmetric.com/hc/en-us/articles/4406023720343-How-to-Pull-Mitchell-1-Data), [Tekmetric Data Migration FAQs index](https://support.tekmetric.com/hc/en-us/sections/360006867754-Data-Migration-FAQs), [The Back Office Data Migrations](https://support.tekmetric.com/hc/en-us/articles/360041362154-The-Back-Office-Data-Migrations), [Identifix Data Migration Overview](https://support.shopmanager.identifix.com/support/solutions/articles/43000720954-data-migration-overview), [Identifix Data Migration Upload Steps](https://support.shopmanager.identifix.com/support/solutions/articles/43000720957-data-migration-upload-steps), [Shopmonkey Data Migration](https://www.shopmonkey.io/solutions/data-migration), [AutoLeap migration blog](https://autoleap.com/blog/data-migration-between-shop-management-software/), [NAPA TRACS Legacy Conversion](https://napatracs.com/legacy-conversion/), [GEM-CAR conversion FAQ](https://www.gem-car.com/faqs/transfer-data-and-history-from-over-100-shops.html), [GreaseGoose](https://www.greasegoose.xyz/blog/mitchell1-alternative/). All **[VENDOR CLAIM]** unless the quote is an admission against interest, in which case it's the most reliable thing on the page.

### What this tells us that the marketing doesn't

1. **$750 is the market price for a job whose input is a file the shop can make for free in ten minutes.** That is the entire commercial migration industry in one sentence.
2. **Nobody moves open ROs.** Tekmetric and Identifix both say so in writing. The shop has **67** of them. This is the sharpest single differentiator available to us, and it maps directly onto the owner's stated fear.
3. **Nobody moves A/R.** Identifix says so explicitly. If the shop is carrying receivables, every commercial option makes him re-key them.
4. **"History migrated" ≠ "history usable."** Tekmetric's own admission — history lands as records but **does not populate reports** — is the gap between a vendor's "we migrate your history" and the owner's mental model of "my numbers are still there." We should decide deliberately whether our reports include pre-cutover data, and tell him which.
5. **No vendor publishes a field-level mapping.** Not one. If we publish ours, we are more transparent than the entire category.
6. **Nobody addresses RO numbering.** Not Tekmetric, not Identifix, not anyone. This is an unclaimed piece of ground and it's item 3 in the owner's verbatim requirement.

### Is Mitchell 1 obstructive?

**About data: no evidence that they are.** They publish the ODBC instructions themselves, the backup is a first-class product feature, and their competitors' migration pipelines depend on it working.

**About leaving: yes, and it's documented.** Mitchell 1's BBB profile shows **55 complaints with 54 unanswered by the company** **[VERIFIED]**, clustered on auto-renewal, cancellation refusals, and continued billing:

> *(June 8, 2026)* "I have been attempting to cancel my Mitchell1 subscription... since April 7, 2025... emailed my representative... all within their required 30-day opt-out window... never responded to a single email. I was continuously charged $147.00 per month for a service I never used."
> *(April 23, 2026)* "I called to cancel on Jan 18th... Mitchell 1 refused my cancellation, claiming it was 'too late.'... trapping me in a contract against my will."

Their [terms](https://mitchell1.com/ordering-terms-and-conditions/) confirm the service **"will renew automatically on a month to month basis"** **[SEARCH-EXTRACT]**.

**The operational rule that falls out of this:** extract and verify the data *first*, cut over *second*, and only then start the cancellation clock — in writing, with dated proof of delivery, well ahead of any renewal date. The friction is billing friction, not data friction, but it is real and it is one-sided.

### The legal angle — no leverage, don't build on it

The brief's premise is close but not exact. Texas **does** have a comprehensive privacy law — the **Texas Data Privacy and Security Act**, effective **July 1, 2024** — and it does include a right to *"receive a portable copy, in digital format, of the consumer's personal data."* But it applies to **natural persons acting in a personal or household context**, not to a business demanding its own commercial records from a software vendor ([Bass Berry summary](https://www.bassberry.com/news/texas-data-privacy-and-security-act/), [Texas State Law Library](https://sll.texas.gov/spotlight/2024/07/texas-data-privacy-and-security-act)) **[SEARCH-EXTRACT]**. There is no consumer-data-portability lever here for the shop.

**Bottom line: we have no legal leverage and we need none.** The data is on his laptop, the vendor documents how to read it, and the extraction is a supported product feature. Do not raise legal theories with Mitchell 1; it converts a non-event into a negotiation. (This paragraph is research, not legal advice — if the exit contract turns adversarial, that's a question for a Texas attorney.)

---

## 5. Recommended migration plan

Principles: **never write to the shop's live machine; always work from a frozen copy; make the owner verify with his own reports; keep Mitchell 1 alive until he says stop.**

### Pass 0 — Secure the artifact (day 1, 20 minutes, zero risk)

1. Owner runs `Configuration → Special Maintenance → Database Backup`, saves to Desktop, clicks **Exit and Backup**, exits Manager SE. All techs and advisors logged out first (Identifix's instructions specify this and they're right).
2. Copy the `.bak` off the laptop twice — one working copy, one archival copy we never touch.
3. **Same session, before we leave the machine:** run the two independent cross-checks — `MM – Create Data Export File` for the customer/vehicle CSV, and export A/R aging + posted-orders reports as "XLS Data Only" with a fixed as-of date. These become our reconciliation targets and they are *his* numbers from *his* system, which is what will make him believe the migration later.
4. Note the value of **Help → About Manager → Core Database Path** — that string gives us the exact instance name.
5. Restore the `.bak` into a local SQL Server Express on our own machine. From this point on, **all development happens against our copy.** The shop's laptop is not touched again until cutover.

*Gate: if the `.bak` will not restore, or if it turns out to be an encrypted/proprietary container rather than a SQL Server backup, stop and fall back to a live ODBC read (§6, Unknown A).*

### Pass 1 — Schema discovery and mapping (our machine, no shop involvement)

Enumerate `ShopMgt`'s tables, columns, keys, and row counts. Produce a written **field-level mapping document** from Mitchell tables to our schema, with an explicit "not migrating, and here's why" list. No competitor publishes one of these; publishing ours is both good engineering and good sales.

Reconcile counts against the Pass 0 CSV and reports before writing a single importer line.

### Pass 2 — Bulk historical migration (customers, vehicles, closed ROs)

Order matters — each depends on the last:

1. **Shop reference data** — techs/advisors, labor rates, tax rates, canned jobs, standard descriptions, vendors, inventory. (Note Identifix explicitly *drops* canned jobs; we shouldn't.)
2. **Customers** — full contact detail. Watch the Tekmetric warning about special characters mangling records; ours should log and quarantine bad rows, never silently drop them.
3. **Vehicles** — linked to customers, with VIN/plate/mileage. Identifix drops vehicle color and production date; trivially avoidable.
4. **Closed repair orders** — header *and* line detail: labor lines with hours and rates, parts lines with cost/price, sublet, fees, tax, totals, technician, dates, mileage. This is where the real work is, and where "history migrated" becomes true instead of decorative.
5. **A/R open balances** — the thing every competitor drops. If the shop carries receivables, migrating these is table stakes for him and a differentiator for us.

**Where RO numbers land** — the explicit answer to his third requirement:

- Store the original Mitchell RO number in a dedicated, permanent, immutable column (`legacy_ro_number`), indexed and searchable, and **display it** on the migrated ticket. When he searches RO 48213 in the new system, RO 48213 comes up. That is what he actually means.
- Seed our own RO sequence to `MAX(mitchell_ro_number) + 1` so the very next ticket he writes continues the series with no collision and no reset. He should not be able to tell where the old system stopped and ours started.
- Record the pairing in a mapping table so any historical document can be traced both directions forever.
- Do the same for invoice numbers if Manager SE numbers them separately from ROs — **[UNKNOWN]** until we see the schema.

### Pass 3 — The 67 open ROs (cutover night)

This is the pass nobody else does, and it is the whole "friction-free" promise.

1. Freeze: shop stops writing in Manager SE at close of business.
2. Take a **fresh** backup — Pass 0's copy is now stale. (Tekmetric schedules extraction one business day before launch for exactly this reason.)
3. Re-run the bulk migration against the fresh copy for the delta since Pass 2.
4. **Migrate the open ROs as open ROs** — every W.I.P. column the owner looks at every day, faithfully: RO number, vehicle, labor tech, sched, status, promised, written-by, order total, time in, telephone, margin %, drop-off, plus all approved and pending line items.
5. Owner reconciles: does our W.I.P. list show 67 rows? Do the RO numbers match? Do the order totals match? Does the A/R total match the report from Pass 0? **He signs off on that, not us.**

### Pass 4 — Parallel period and decommission

- Run both systems in parallel for a defined window (2–4 weeks is normal). New work in ours; Mitchell 1 stays installed and paid, read-only, as the reference.
- Keep the restored `ShopMgt` copy permanently. Even after cancellation, a SQL Server Express restore of that `.bak` is a forever-accessible archive of the shop's entire history. That alone eliminates most of the fear in his verbatim ask.
- Only after his sign-off: send written cancellation to Mitchell 1, dated, with delivery proof, ahead of the renewal date. Expect it to require chasing.

### The honest bottom line on fidelity

The market's practical answer is *"customers + vehicles migrate cleanly; closed history migrates as records but not into reports; open ROs and A/R get re-keyed by hand."* That is not a technical limit — it is a **commercial** limit, driven by conversion vendors doing a fixed-price job across 150 different source systems. Identifix and Tekmetric both put it in writing.

**For us that limit doesn't apply**, because we have direct SQL access to a documented Microsoft SQL Server database and we own the destination schema. Full-fidelity migration — including all 67 open ROs, A/R, and RO-number continuity — is genuinely achievable. But be honest about what it costs: it is **our engineering time**, concentrated in Pass 2 step 4 (closed RO line detail) and Pass 3 (open RO reconstruction), and it cannot be estimated properly until someone has looked at the actual table structure. Everything before that estimate is a guess.

---

## 6. Open unknowns, and the cheapest experiment for each

| # | Unknown | Why it matters | Cheapest experiment |
|---|---|---|---|
| **A** | Is the Special Maintenance `.bak` a plain SQL Server backup, or a proprietary/encrypted container? | Decides whether Pass 0 works at all, and whether we can develop offline | Have the owner produce one backup and email it. Try `RESTORE DATABASE` into free SQL Server Express. **~30 minutes, answers the whole question, zero risk to the shop.** Do this first. |
| **B** | Does connecting to `ShopMgt` need SQL credentials Mitchell 1 controls, or is local Windows admin enough? | Decides whether live/delta pulls are available, or only file-based backups | Follow Mitchell 1's own KB id-200 ODBC steps on the shop laptop and click **Test Data Source**. Their doc says it should succeed. ~10 minutes. |
| **C** | Is 9.2.1.5356 still SQL Server / `ShopMgt` / `SHOPSTREAM`? (Our evidence is a 6.x doc plus a "6.4 or later" third-party note.) | Everything above rests on it | **Help → About Manager → Core Database Path** on the shop's screen. One screenshot. Zero risk. Confirms or kills it instantly. |
| **D** | The actual `ShopMgt` schema — tables, keys, how ROs join to lines, how RO vs. invoice numbers are assigned | This is the entire Pass 2 estimate. No public schema documentation exists — I searched hard and found none. | Enumerate `INFORMATION_SCHEMA.TABLES` / `.COLUMNS` on our restored copy. Half a day, and it converts every "days not weeks" hand-wave into a real number. |
| **E** | Are the 67 open ROs fully represented in the DB, or partly in transient/session state? | Pass 3 is the differentiator; if open ROs aren't durably stored, the plan changes | Compare the W.I.P. screen's 67 rows against the equivalent query on the restored copy. Row-for-row. |
| **F** | Where do BOLT ON / Mobile Manager inspection photos live, and are they in the backup? | Possible silent data loss the owner won't notice for months | Ask the owner if he uses Mobile Manager/DVI. If yes: file-level sweep of `C:\Program Files (x86)\M1-SK\` and `C:\ProgramData\M1-SK\` alongside the DB. |
| **G** | Does Manager SE hold A/R with enough structure to migrate balances *and* their aging? | Determines whether we can beat Identifix's explicit A/R drop | Falls out of D. Cross-check against the Pass 0 A/R aging report. |
| **H** | Mitchell 1's actual notice/cancellation terms on **this** account | BBB shows a 30-day opt-out window and refused cancellations. Getting this wrong costs real money after cutover. | Owner pulls his signed Order Form / invoice and reads the term and notice window. Not a research question — a paperwork question, and it should happen in week 1, not at cutover. |

**Things I explicitly could not confirm and did not guess:** Mitchell 1's forum (`managerforum.net` / `managerforum.buymitchell1.net`) and several `buymitchell1.net` help pages are behind Cloudflare bot protection that blocked every fetch route I tried, direct and proxied. Everything sourced from those pages is marked **[SEARCH-EXTRACT]** and should be treated as a lead, not a fact — specifically: backup file naming, the `C:\ProgramData\M1-SK\Backup` location, the legacy `mdb` restore folder, and the BOLT ON photo gap. None of the load-bearing conclusions in §1–§5 depend on them.

---

### Sources

- [Mitchell 1 KB — SE Using Custom Data Export Option](https://kb.mitchell1.com/articles/id-200/) · [the PDF itself](https://kb.mitchell1.com/wp-content/uploads/2020/11/sql_excel_6.x.pdf)
- [Mitchell 1 KB — Export Data from Manager SE Followup Reports to .CSV](https://kb.mitchell1.com/articles/id-321/)
- [Mitchell 1 KB — Manager SE System Requirements](https://kb.mitchell1.com/articles/id-1521/) · [Manager SE Reports PDF](https://kb.mitchell1.com/wp-content/uploads/2020/12/Manager-SE-Reports.pdf)
- [Mitchell 1 — Manager SE 9.x Installation Guide](https://mitchell1.com/wp-content/uploads/2025/01/SE65GettingStartedGuide.pdf) · [Support Documents index](https://mitchell1.com/resources/manager-se/documents/) · [Ordering Terms & Conditions](https://mitchell1.com/ordering-terms-and-conditions/) · [Manager 20th anniversary press release](https://mitchell1.com/press/mitchell-1-manager-marks-20th-anniversary-with-major-enhancements-to-streamline-workflow)
- [Value Added Services — Data Transfer App installation instructions](https://valueaddedonline.com/DataTransferApps/Instructions%20on%20Data%20Transfer%20App%20Installation.htm)
- [Tekmetric — How to Pull Mitchell 1 Data](https://support.tekmetric.com/hc/en-us/articles/4406023720343-How-to-Pull-Mitchell-1-Data) · [Mitchell1 Data Migration](https://support.tekmetric.com/hc/en-us/articles/360041811413-Mitchell1-Data-Migration) · [Protractor Data Migration](https://support.tekmetric.com/hc/en-us/articles/360041832153-Protractor-Data-Migration) · [The Back Office Data Migrations](https://support.tekmetric.com/hc/en-us/articles/360041362154-The-Back-Office-Data-Migrations) · [Data Migration FAQs index](https://support.tekmetric.com/hc/en-us/sections/360006867754-Data-Migration-FAQs) · [Data Pull Instructions index](https://support.tekmetric.com/hc/en-us/sections/4406217843863-Data-Pull-Instructions) · [Export & Submit Customer List](https://support.tekmetric.com/hc/en-us/articles/360041832613-Export-Submit-Customer-List)
- [Identifix Shop Manager — Data Migration Overview](https://support.shopmanager.identifix.com/support/solutions/articles/43000720954-data-migration-overview) · [Data Migration Upload Steps](https://support.shopmanager.identifix.com/support/solutions/articles/43000720957-data-migration-upload-steps)
- [Shopmonkey — Data Migration](https://www.shopmonkey.io/solutions/data-migration) · [AutoLeap — Data Migration Between Providers](https://autoleap.com/blog/data-migration-between-shop-management-software/) · [NAPA TRACS — Legacy Conversion](https://napatracs.com/legacy-conversion/) · [GEM-CAR — transfer from 100+ systems](https://www.gem-car.com/faqs/transfer-data-and-history-from-over-100-shops.html) · [GreaseGoose — Mitchell 1 alternative](https://www.greasegoose.xyz/blog/mitchell1-alternative/)
- [BBB — Mitchell1 complaints](https://www.bbb.org/us/ca/san-diego/profile/auto-repair-equipment/mitchell1-1126-29000405/complaints)
- [Diagnostic Network — Management Software thread](https://diag.net/msg/m5d8wqry65o4zj5afawnv3y7yw) · [AutoShopOwner — Who has changed their shop management program recently?](https://www.autoshopowner.com/forums/topic/20599-who-has-changed-their-shop-management-program-recently-happy-not-so-happy-or)
- [Wikipedia — Bolt On Technology](https://en.wikipedia.org/wiki/Bolt_On_Technology)
- [Bass, Berry & Sims — Texas Data Privacy and Security Act](https://www.bassberry.com/news/texas-data-privacy-and-security-act/) · [Texas State Law Library — TDPSA](https://sll.texas.gov/spotlight/2024/07/texas-data-privacy-and-security-act)
