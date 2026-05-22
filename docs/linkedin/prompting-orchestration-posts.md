# LinkedIn series — Prompting orchestration

Six short posts. Each one takes a real design decision from the prompting
orchestration in this codebase and turns it into one idea worth reading.

How they were written:
- **Content** is drawn strictly from real patterns in our production prompts —
  not invented, not borrowed. No customer data, no code, no secret sauce.
- **Product and domain are kept anonymous.** "A product I'm building," "an AI
  system I work on." No company name, no industry.
- **Voice** is meant to read like one builder talking, not a content account.
  Uneven pacing, a clear point of view, no AI tells. Teaching, not selling.

Suggested cadence: one post every 3–5 days, in order. Lead generalist, get
sharper. No hashtags needed; if you want them, 2–3 max at the very bottom.
Drop the `[N/6]` tags if you'd rather they not read as a fixed series.

---

## Post 1 — What the prompt forbids

Most of our system prompt is telling the AI what *not* to do.

I'm building an AI that guides experts through hard diagnostic work. Early on it had a habit. Every few steps it would ask the user to upload a photo or a document. Capture this. Scan that.

Made sense to the model — more data, better answer. But the person using it has their hands full and is mid-task. Stopping to be a photographer is a real cost to them. And processing all of it costs us real money too.

So we wrote a rule. Ask for an upload only when the user genuinely can't put the thing into words. A dense diagram. A screen full of readings. Everything else — trust their description and keep moving.

The part that stuck with me: that one rule is longer than the section telling the model what its actual job is.

A good prompt isn't a wish list of everything you'd like. It's mostly a list of the model's instincts you've decided to overrule.

---

## Post 2 — A number is a place to hide

I won't let our AI tell me it's "80% confident."

When the model proposes a next step, it reports how sure it is. Normal enough.

But there's a rule sitting on top of that. If confidence drops below a threshold, a number isn't allowed to be the whole answer. The model has to write one sentence naming the specific thing it's unsure about. Not "moderate uncertainty." The actual gap, in plain words.

Then it has to say what would close that gap — one question the user can answer right now.

Why go to the trouble? Because "80% confident" is useless to the person who has to act on it. It doesn't tell them what to do next. A named doubt does.

If your AI is unsure, don't let it round that feeling off into a percentage. Make it say the doubt out loud, in a sentence somebody can actually act on.

---

## Post 3 — Stop reaching for the chat box

Our AI doesn't hold a conversation. It edits a structure.

The easy way to build an assistant is a chat box. User types, model replies, repeat forever. We didn't do that.

The model's output isn't a message. It's a structured map of the problem — steps, branches, each with a status. When the user reports what they found, the model doesn't write a paragraph back. It closes one branch, drops the dead ones, and lights up the next step.

So the user sees a single instruction at a time. Underneath it, the model is quietly maintaining the whole map.

Two things you get from this. The model can't wander off — it's editing a structure, not free-associating into a text box. And the user is never dumped with a wall of text to decode while they're busy.

If you're building with these models, question the chat box. Sometimes the output you want isn't prose the model generates. It's state the model edits.

---

## Post 4 — A rule that lives only in a prompt isn't a rule

We wrote a prompt that says "do not do X." Then we assumed it would fail anyway, and wrote code to catch it.

Our product has two phases. In the first, the AI helps work out what's wrong. Then that conclusion gets locked, and the tool switches to helping the user execute on it.

After the lock, the prompt is blunt: the conclusion is final. Do not revise it. Do not argue with it.

But we don't trust that prompt. A model can be talked out of almost anything by the right input. So the response is allowed to carry only two fields. Anything else the model tries to send back — including any attempt to reopen that locked conclusion — gets stripped by our server before it touches anything real.

The prompt sets the intent. The code enforces it.

A rule that lives only in a prompt isn't really a rule. It's a hope. If a boundary actually matters, it has to exist somewhere the model can't talk its way past.

---

## Post 5 — Tell it who to believe

We told our AI exactly who to believe. And in what order.

When the model works a problem, it pulls from a few sources. A database of past cases. Material from the open internet. And notes written by the most experienced person on our side.

We don't treat those as equal. The prompt lays out a trust order. Something one expert personally verified outranks a hundred cases that merely look similar. Statistical resemblance is a weak signal. Vetted, hands-on experience is a strong one.

One more rule. When two sources disagree, the model isn't allowed to quietly pick a winner and move on. It has to surface the conflict — name both sides, say which one it's trusting, say why.

Most AI mistakes I run into aren't the model being dumb. They're the model treating a weak source and a strong source as if they weighed the same.

Give it a trust order. And make it show you the disagreements instead of burying them.

---

## Post 6 — Consensus is not truth

"Consensus is not truth." We had to write that into the prompt, close to word for word.

When our AI learns from real-world sources, a lot of what it reads is confident and wrong. Popular answers that don't hold up.

So there's a rule. Don't trust agreement on its own. Trust agreement only after it survives a basic plausibility check. If a crowd of sources all swear by a fix that simply can't work — throw out the whole crowd, however large it is.

The model isn't counting votes. It's testing each claim against first principles and discarding the ones that can't be true, no matter how many people repeat them.

A pile of agreement isn't evidence. It's just a pile. Popularity and correctness are two different measurements, and a surprising number of AI products quietly treat them as one.

If your system learns from a crowd, it needs a filter that isn't the crowd.
