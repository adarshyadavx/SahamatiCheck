# Hindi glossary (draft for native-speaker review)

The same English term must be translated the same way everywhere (website, extension, server-written report text, rule names).
All Hindi in this repository was written by Claude and has **not** been reviewed by a native speaker. The reviewer fills the
"Decision" column, then `review/hi.csv` is re-exported and approved keys are recorded in `review/hi-reviewed.json`.

Regenerate the strings to review: `cd backend && .venv/bin/python scripts/export_hindi_review.py` (`--status` shows progress).

| English | Current Hindi | Decision |
|---|---|---|
| privacy policy | गोपनीयता नीति | |
| data-safety section (Play) | डेटा-सुरक्षा अनुभाग | |
| permission | अनुमति | |
| advertising ID | विज्ञापन आईडी | |
| third party / third parties | तीसरा पक्ष / तीसरे पक्ष (a few places still say तृतीय पक्ष) | |
| evidence | सबूत (20 uses) and प्रमाण (17 uses) are both in use | pick one |
| difference found | अंतर मिला | |
| possible difference | संभावित अंतर | |
| unclear, needs a closer look | अस्पष्ट, ध्यान से देखें | |
| couldn't check | जाँच नहीं हो सकी | |
| no issue found in what we could check | जितना जाँच सके, उसमें कोई समस्या नहीं मिली | |
| not mentioned | उल्लेख नहीं | |
| grievance officer | शिकायत अधिकारी | |

Already unified mechanically (same gender and number, no grammar change): सेक्शन → अनुभाग, "विज्ञापन ID" → "विज्ञापन आईडी".

## What the reviewer checks in every string
1. **Meaning**, above all that a negation is kept ("does not share" must not become "shares").
2. **Neutral tone**: "difference found", never an accusation. The wording lint (`node packages/i18n/check-wording.mjs`) blocks the banned words, but cannot judge tone.
3. **Plain everyday Hindi**, not legal Sanskritised wording.
4. **Fit**: the text must not break the layout. Look at the rendered `/hi` pages and the extension panel, not only the CSV.

Proper nouns and technical terms that stay in Latin script (SDK, Android, Google, APK, app names) are listed in
`backend/api/tests/test_i18n_coverage.py` (`ALLOWED`); the test fails when any other English word appears in Hindi report text.
