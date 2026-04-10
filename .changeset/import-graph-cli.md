---
"@tisyn/cli": patch
---

Add output path writability validation to config

- Validate that pass output paths are writable during config resolution
- Check existing output files for write permission
- Walk up to nearest existing ancestor directory to verify writability for new output paths
