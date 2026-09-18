# Third-Party Notices

This extension bundles the following open-source software under `vendor/`. Use each package
in accordance with its license terms, copyright notices, and disclaimers. Consult each
project's distribution and linked source for the latest license and complete copyright notices.

| Open-source software | License | Bundled file | Source |
| --- | --- | --- | --- |
| marked | MIT License | `vendor/marked.min.js` | <https://github.com/markedjs/marked> |
| DOMPurify | Apache-2.0 / MPL-2.0 | `vendor/purify.min.js` | <https://github.com/cure53/DOMPurify> |
| highlight.js | MIT License | `vendor/highlight.min.js` | <https://github.com/highlightjs/highlight.js> |
| Mermaid | MIT License | `vendor/mermaid.min.js` | <https://github.com/mermaid-js/mermaid> |
| Adaptive Cards 3.0.6 | MIT License | `vendor/adaptivecards.min.js` (locked chunk) | <https://github.com/microsoft/AdaptiveCards> |

The highlight.js license text is also bundled in
[`vendor/highlight.LICENSE`](./vendor/highlight.LICENSE). Because DOMPurify's upstream
distribution terms provide multiple license options, users should review the upstream LICENSE.

The Adaptive Cards license and the upstream bundle's embedded third-party notice are
preserved in [`vendor/adaptivecards.LICENSE`](./vendor/adaptivecards.LICENSE) and
[`vendor/adaptivecards.min.js.LICENSE.txt`](./vendor/adaptivecards.min.js.LICENSE.txt).
The JavaScript SDK is loaded only for the experimental `adaptive-card` fence.

Include this file in this repository's extension distribution. Do not remove copyright notices
or license links for bundled open-source software from release ZIP files or other distributions.
