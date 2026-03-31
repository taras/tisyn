---
"@tisyn/kernel": minor
---

Recognize `"scope"` as a compound-external operation in the kernel classifier.

- Add `"scope"` to `COMPOUND_EXTERNAL_IDS` set in `classify.ts` so the kernel routes scope eval nodes through the compound-external path rather than the standard external-eval dispatch path
