---
title: XSS Fixture - Obfuscated Script Tags
category: Test
level: LOW
summary: Unpublished fixture covering obfuscated/encoded script variants (mixed case, HTML-entity-encoded, comment-wrapped) meant to bypass naive string-matching filters. published:false keeps it off the live site.
sources: []
lastVerified: 2026-07-01
published: false
---

Mixed-case script tag:

<ScRiPt>window.__xss_mixedcase = 1</ScRiPt>

Entity-encoded script tag:

&lt;script&gt;window.__xss_entity = 1&lt;/script&gt;

Comment-wrapped script tag:

<!--<script>window.__xss_comment = 1</script>-->
