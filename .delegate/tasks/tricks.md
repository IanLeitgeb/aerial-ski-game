You are extracting trick recognition and difficulty scoring into a shared engine module.

## Source, verbatim from game.js

```js
    function matchTrick(perFlipTwists, tuckedPerFlip, key) {
        const parts = key.split(',');
        if (parts.length !== perFlipTwists.length) return false;
        return parts.every((p, i) => {
            if (p === 't') return perFlipTwists[i] === 0 && tuckedPerFlip[i];
            return perFlipTwists[i] === parseInt(p);
        });
    }

    function calcDD(perFlipTwists) {
        const key = perFlipTwists.join(',');
        if (DD_TABLE[key] !== undefined) return DD_TABLE[key];
        // Fallback for unlisted combos
        const flips = perFlipTwists.length;
        const twists = perFlipTwists.reduce((a, b) => a + b, 0);
        return Math.round((1.4 + flips * 0.5 + twists * 0.4) * 1000) / 1000;
    }
```

And the lookup table it uses, verbatim — reproduce it EXACTLY, every entry, no
reformatting of the numbers:

```js
    const DD_TABLE = {
        // Singles
        '0':1.70, '1':2.00, '2':2.30, '3':2.60,
        // Doubles
        '0,0':2.10,
        '0,1':2.50, '1,0':2.50,
        '1,1':3.15,
        '0,2':3.00, '2,0':3.00,
        '1,2':3.50, '2,1':3.50,
        '2,2':4.00,
        '0,3':3.30, '3,0':3.30,
        '1,3':3.80, '3,1':3.80,
        '2,3':4.30, '3,2':4.30,
        '3,3':4.70,
        // Triples
        '0,0,0':2.90,
        '1,0,0':3.30, '0,1,0':3.30, '0,0,1':3.20,
        '1,1,0':3.80, '1,0,1':3.75, '0,1,1':3.75,
        '1,1,1':4.425,
        '2,0,0':3.50, '0,2,0':3.50, '0,0,2':3.40,
        '2,1,0':4.00, '1,2,0':4.00, '0,2,1':4.00, '0,1,2':3.90, '1,0,2':3.90, '2,0,1':3.95,
        '2,1,1':4.75, '1,2,1':4.75, '1,1,2':4.65,
        '2,2,0':5.00, '0,2,2':5.00, '2,0,2':4.90,
        '2,2,1':5.25, '2,1,2':5.20, '1,2,2':5.20,
        '2,2,2':5.70,
        '2,3,2':6.30,
        '3,1,1':5.05, '1,3,1':5.05, '1,1,3':4.95,
        // Quads — lays and single-fulls
        '0,0,0,0':3.50,
        '1,0,0,0':3.90, '0,1,0,0':3.90, '0,0,1,0':3.90, '0,0,0,1':3.80,
        '1,1,0,0':4.40, '1,0,1,0':4.35, '1,0,0,1':4.30,
        '0,1,1,0':4.40, '0,1,0,1':4.35, '0,0,1,1':4.30,
        '1,1,1,0':5.00, '1,1,0,1':4.95, '1,0,1,1':4.95, '0,1,1,1':4.95,
        '1,1,1,1':5.80,
        // Quads — one double-full
        '2,0,0,0':4.10, '0,2,0,0':4.10, '0,0,2,0':4.00, '0,0,0,2':4.00,
        // Quads — double-full + one single-full
        '2,1,0,0':4.60, '1,2,0,0':4.60,
        '2,0,1,0':4.55, '0,2,1,0':4.55,
        '2,0,0,1':4.50, '0,2,0,1':4.50,
        '1,0,2,0':4.50, '0,1,2,0':4.50,
        '1,0,0,2':4.45, '0,1,0,2':4.45,
        '0,0,2,1':4.45, '0,0,1,2':4.40,
        // Quads — double-full + two single-fulls
        '2,1,1,0':5.10, '1,2,1,0':5.10, '1,1,2,0':5.10,
        '2,1,0,1':5.05, '1,2,0,1':5.00,
        '2,0,1,1':5.00, '0,2,1,1':5.00,
        '0,1,2,1':5.00, '1,0,2,1':5.00,
        '1,1,0,2':4.95, '1,0,1,2':4.95, '0,1,1,2':4.95,
        // Quads — double-full + three single-fulls
        '2,1,1,1':5.95, '1,2,1,1':5.90, '1,1,2,1':5.90, '1,1,1,2':5.85,
        // Quads — two double-fulls
        '2,2,0,0':5.10, '2,0,2,0':5.05, '2,0,0,2':5.00,
        '0,2,2,0':5.10, '0,2,0,2':5.00, '0,0,2,2':4.95,
        // Quads — two double-fulls + one single-full
        '2,2,1,0':5.60, '2,2,0,1':5.55,
        '2,1,2,0':5.55, '2,0,2,1':5.50,
        '2,1,0,2':5.45, '2,0,1,2':5.45,
        '1,2,2,0':5.55, '0,2,2,1':5.50,
        '1,2,0,2':5.45, '0,2,1,2':5.45,
        '1,0,2,2':5.45, '0,1,2,2':5.45,
        // Quads — two double-fulls + two single-fulls
        '2,2,1,1':6.10, '2,1,2,1':6.05, '2,1,1,2':6.00,
        '1,2,2,1':6.05, '1,2,1,2':6.00, '1,1,2,2':5.95,
        // Quads — three double-fulls
        '2,2,2,0':5.70, '2,2,0,2':5.65, '2,0,2,2':5.65, '0,2,2,2':5.65,
        // Quads — three double-fulls + one single-full
        '2,2,2,1':6.40, '2,2,1,2':6.35, '2,1,2,2':6.30, '1,2,2,2':6.30,
        // Quads — four double-fulls
        '2,2,2,2':6.80,
        // Quads — one triple-full
        '3,0,0,0':4.30, '0,3,0,0':4.30, '0,0,3,0':4.20, '0,0,0,3':4.15,
        // Quads — triple-full + one single-full
        '3,1,0,0':4.85, '1,3,0,0':4.85,
        '3,0,1,0':4.80, '0,3,1,0':4.80,
        '3,0,0,1':4.75, '0,3,0,1':4.75,
        '1,0,3,0':4.75, '0,1,3,0':4.75,
        '0,0,3,1':4.65, '1,0,0,3':4.65, '0,1,0,3':4.60, '0,0,1,3':4.55,
        // Quads — triple-full + two single-fulls
        '3,1,1,0':5.50, '3,1,0,1':5.40, '3,0,1,1':5.35,
        '1,3,1,0':5.50, '1,3,0,1':5.40, '0,3,1,1':5.35,
        '1,1,3,0':5.45, '1,0,3,1':5.35, '0,1,3,1':5.40,
        '1,1,0,3':5.25, '1,0,1,3':5.25, '0,1,1,3':5.25,
        // Quads — triple-full + three single-fulls
        '3,1,1,1':6.30, '1,3,1,1':6.25, '1,1,3,1':6.20, '1,1,1,3':6.10,
    }
```

## Produce `engine/core/tricks.js`

Namespace: `tricks`. No dependencies on other engine modules.

Export: `DD_TABLE`, `matchTrick(perFlipTwists, tuckedPerFlip, key)`,
`calcDD(perFlipTwists, table)`.

`calcDD` takes an OPTIONAL second parameter `table`, defaulting to the module's
`DD_TABLE`, so another discipline (trampoline, diving) can supply its own
difficulty table. It must use `table` when given. Everything else is unchanged.

This is SHARED scoring structure — the tables differ per sport (FIS vs FIG) but
the lookup-with-fallback logic is identical.

Use EXACTLY this dual-mode wrapper (the project has no bundler; the file must load
via require() in Node, <script> in a browser, and vm.runInContext in the harness):

```js
(function (global) {
'use strict';

// ... body ...

const api = { /* exports */ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).NAMESPACE = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
```

For a dependency on another engine module (there is no `require` in a browser):

```js
const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;
```

HARD CONSTRAINTS (these apply to every task):
- Arithmetic and its ORDER must be byte-for-byte identical to the original.
  Do NOT algebraically rearrange, do NOT factor out repeated subexpressions,
  do NOT change `x*x` to `x**2`. Floating-point maths is not associative.
- Keep every explanatory comment.
- No BABYLON, no DOM, no localStorage, no window.
- Output ONLY code. No prose, no markdown fences.

Output format — exactly this, no other text:

===FILE: engine/core/tricks.js===
<contents>
