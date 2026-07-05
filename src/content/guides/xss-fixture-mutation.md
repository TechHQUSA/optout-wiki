---
title: XSS Fixture - Mutation XSS Classics
category: Test
level: LOW
summary: Unpublished fixture covering classic mutation-XSS (mXSS) sanitizer-bypass patterns (noscript/title parser-differential trick, math/mglyph/style foster-parenting trick). published:false keeps it off the live site.
sources: []
lastVerified: 2026-07-01
published: false
---

<noscript><p title="</noscript><img src=x onerror=alert(1)>">noscript text</p></noscript>

<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(2)>
