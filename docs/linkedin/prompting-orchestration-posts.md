# LinkedIn series — How to build an AI that reasons

Six short posts on one topic: the architecture of an AI **reasoning engine** —
a system built to solve problems, not just answer prompts. Chatbot vs. solver.

Framing:
- **Fully general.** No product, no industry, no "I'm building." The subject is
  the architecture itself.
- **Concrete without being domain-specific.** The proof in each post is the
  mechanics of the engine — how it narrows, when it stops, what it refuses to
  do — not an example field.
- **Voice** is one person who has clearly thought hard about this. Opinionated,
  uneven, no AI tells. Teaching, not selling.

Lineage worth knowing (useful in comments, not needed in the posts): the
"general process + swappable domain" idea is the 1959 General Problem Solver
and 1970s expert-system design. What's new is that LLMs finally make the
general engine genuinely general. Key terms: *cost-aware inference / value of
information* (post 2–3), *abductive reasoning* (post 2).

Suggested cadence: one post every 3–5 days, in order. No hashtags needed.

---

## Post 1 — Build a problem-solver, not a tool

Most people building with AI right now are building tools. A tool does one task. You ask, it answers.

I think the more interesting thing to build is a problem-solver — and those are not the same object.

A tool knows answers. A problem-solver knows how to *get* to one. How to move from a broken, half-understood state to a resolved one without wasting moves. The first is a lookup. The second is a process.

Here's why the difference matters. Every troubleshooting situation, in any field, has the same skeleton. A bad state. A goal state. A fog of possible causes in between. Strip the industry off a mechanic, a doctor, an engineer chasing a bug — and the shape of what they're doing is identical.

So you don't have to build something good at one task. You can build the *process*, and point it at a task.

That's a different ambition. And it quietly changes every design decision that comes after it.

---

## Post 2 — Every problem is a search through wrong answers

Here's a frame that reorganized how I think about this.

Every problem is a search through a space of wrong answers.

When something is broken, the cause is one of many possible causes — and most of them are wrong. The job isn't "find the answer." It's *eliminate the wrong ones cheaply* until one is left standing.

That reframes what a good problem-solver actually does. It isn't the one that knows the most. It's the one that asks the single question that cuts the space of possibilities in half. Then asks the next one.

A weak solver gathers everything it can, then thinks. A strong one thinks first — about which one piece of information is worth gathering next — and ignores the rest until that piece earns its place.

If you're designing AI to reason, stop optimizing for how much it knows. Optimize for how fast it can rule things out.

---

## Post 3 — "Efficient" is a cost function, not a constant

Every problem-solver is trying to be efficient. But "efficient" might be the most misunderstood word in the room.

Efficient is not a universal quantity. It's a cost function. And that function changes completely depending on where you point the solver.

In one setting the expensive thing is time. In another it's money. In another it's a move you can't undo. In another it's someone's safety. Same word — "efficient" — pointing at four different things.

This is the part that lets one engine work across domains. The reasoning core stays fixed: generate the possibilities, narrow them, act. What you swap, per field, is the definition of *expensive*. That single component is the whole difference between a solver that's good here and a solver that's good there.

Most AI products quietly hardcode one cost function and call it general intelligence. It isn't. It's one setting, frozen.

---

## Post 4 — The constraints are the product

A problem-solver with no constraints is just a chatbot.

I didn't believe that at first. I thought the intelligence was the valuable part — the reasoning, the knowledge. Build that well and the rest is detail.

It's the other way around.

An unconstrained reasoner will do the obvious thing every time. It'll gather every scrap of evidence it can reach, because more data feels safer. It'll hand over an answer the second it has one, because answering feels like helping. It'll treat every source as equally true. Every one of those instincts is wrong — and every one of them is the default.

So the real work isn't adding intelligence. It's installing restraint. The moves it won't make. The evidence it won't waste. The answer it won't give until it has earned the right to.

What a solver refuses to do is not a limitation on the product. It is the product.

---

## Post 5 — A confidence number is a place to hide

Build a reasoning system and sooner or later it will tell you it's "80% confident." Don't accept that. A number is a place to hide.

Confidence as a percentage feels rigorous. It isn't. It's a feeling compressed into a digit, and it tells the person who has to act on it nothing about what to do next.

The fix is a rule. Below some threshold, a number is not an acceptable answer. The system has to name the *specific* thing it's unsure about — one sentence, plain words. And then say what would resolve it.

"I'm not sure" is noise. "I can't tell whether these two symptoms started at the same time, and one question would settle it" is a next move.

Uncertainty you can't act on is just anxiety. Make the doubt specific enough to do something with — or it wasn't worth surfacing at all.

---

## Post 6 — Knowing the edge of what it knows

The hardest thing to build into a reasoning system is the ability to stop.

There are two kinds of stopping. The first is easy: knowing it's done — the answer is found, quit. The second is the hard one. Knowing it has reached the edge of what it can actually know, and saying so out loud.

A system that won't admit that edge will paper over the gap with something that sounds right. It'll borrow a pattern from a situation that only *looks* similar. It'll hand back a clean answer built partly on a guess, and never flag which part was the guess.

So you build the honesty in as a rule. Reasoning from solid ground — fine. Extrapolating — then it has to say "this part is an educated guess, verify it." Out loud, in the answer.

A solver that knows the edge of its own knowledge is worth ten that don't. Confidence is easy. Knowing where confidence ends is the whole game.
