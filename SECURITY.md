# Security Notes

## Axios review

On April 1, 2026, this repository was reviewed for `axios` usage after reports that `axios` `1.14.1` and `0.30.4` were compromised.

No `axios` dependency was present in this repo at the time of review, so no package pin or override was added.

If `axios` is introduced later, review current security advisories first and avoid `1.14.1` and `0.30.4`.
