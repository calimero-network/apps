# Third-party notices

## Chess pieces

The "Chessnut" piece layout, Copyright 2015 Alexis Luengas, from
<https://github.com/LexLuengas/chessnut-pieces>, the same set the web app draws (`../app/src/pieces.tsx`).

Licensed under the Apache License, Version 2.0. The full licence text ships inside both apps:
`ios/Resources/Licenses/chessnut-pieces-LICENSE.txt` (app bundle) and
`android/app/src/main/assets/licenses/chessnut-pieces-LICENSE.txt` (APK assets). Both apps credit it
under Account → Acknowledgements.

Changes from the original files: exported from the web app's inlined markup by
`scripts/export-pieces.mjs`. Inline styles became presentation attributes and hidden
(`display:none`) elements were dropped; for Android, circles, ellipses and lines became paths
(VectorDrawable has no other shapes). The launcher icons place the knight on a lime tile. The
artwork itself is unchanged.
