---
name: plain-language
description: Use when the user explicitly asks for plain language, plainer wording, simpler wording, shorter wording, full sentences, or a more direct rewording of an explanation. Produces concrete, concise answers without jargon.
---

# Plain Language

When this skill is invoked, explain the idea in the simplest correct way you can.

Write like a strong engineer speaking plainly:

- short full sentences
- main point first
- concrete words
- no jargon unless it is required
- no extra framework unless the user asked for depth
- no bullets unless the user asked for them
- maximum 5 sentences
- prefer 2 sentences
- put each sentence on its own line
- do not mention the skill by name in the answer
- do not add meta lead-ins like `Using plain-language...`, `Using the plain-language skill...`, or similar

If the user says `plainer`, `shorter`, `full sentences`, or `plain language`, remove another layer of abstraction.

The fenced code blocks below are only used inside this skill to contain example text cleanly. They are not part of the desired output. Do not include the backticks in the actual answer unless the user explicitly asks for a code block.

Dense:

```text
The current bottleneck is scheduler-level preemption caused by shared dirty-state semantics.
```

Plain:

```text
The main problem is that the system keeps choosing to scan the repo again.
It should keep filling the missing PRs instead.
```

Dense:

```text
The remaining production issue is not a fundamental systems-design failure, but rather an inconsistency in how repository identity is modeled at the persistence boundary.
```

Plain:

```text
The main design is fine.
The problem is that the database is treating the repo name as permanent when it is not.
```

Dense:

```text
The observed throughput degradation appears to be a function of cyclical coordination between inventory-generation refresh work and bounded backfill execution, where scan overhead, scheduler phase transitions, and residual indexing-side write amplification combine to reduce end-to-end convergence velocity.
```

Plain:

```text
It is slow because it still spends too much time rescanning the repo instead of backfilling PRs.
The quickest fix is to let backfill run longer each time.
```
