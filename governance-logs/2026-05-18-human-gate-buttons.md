# Human Gate Buttons

- timestamp: 2026-05-18T15:55:00+08:00
- status: implemented
- owner: trading-agents-workflow

## Correction

Human Gate decisions must not depend on agents interpreting free-form text such as `Plan C`.

The previous workflow context alias direction has been reverted. The durable path is now button-first:

- Cat Claw submits Human Gate choices as buttons.
- Each button gets a stored callback token under `human_gate_buttons`.
- `human_gate.inbox` / `human_gate.console` render the same stored buttons in the Flashcat/Cat Claw operation console.
- Telegram inline button callbacks use the `tawhg:<token>` namespace.
- The callback handler records the exact selected button and dispatches `human_gate_resume` to cat-brain `main`.
- Natural-language plan labels remain display text only; the callback token is the controlling decision reference.

## Boundary

If a Human Gate request includes buttons, agents should wait for button callbacks or an explicit structured resume. They must not infer Flashcat's decision from ambiguous text when a button decision is available.

Telegram is only a delivery surface. The durable decision surface is the plugin-side Human Gate record plus `human_gate_buttons`; console, Telegram, and CLI callback all operate on the same rows.
