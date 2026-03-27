---
"@tisyn/compiler": minor
"@tisyn/ir": minor
"@tisyn/kernel": minor
"@tisyn/validate": minor
---

Add local-state authoring support to the compiler via SSA lowering for let bindings and
reassignment. This enables workflow-local state patterns such as accumulating chat history
with let plus rebinding, adds structural spread lowering for arrays and objects, and
preserves deterministic replay semantics by lowering mutable-looking source into immutable
IR.
