# Mero Design — reported issues

Fran's `IMPORTANT.md`, vendored into the repo so CI can check status against it and
renumbered as an explicit list (the original is 18 lines, two of which are wraps of
the line above, giving **15 distinct items**). Item wording is verbatim.

Update this file when the source list changes, then run `pnpm tasks --write`.

1. Can't select multiple layers at once and move them
2. Line when drawn is not displayed at all, its displayed in layer but on canvas its height 0 whatever the color or we change height we cant see it - same thing with arrow item
3. pencil item does not do anything at all
4. layers -> up and down should only do 1 up or down not front to back
5. text object cant be resized up and down
6. stroke not working on images and fill also not working on blob images
7. stroke not working on text -> so maybe remove it or what
8. Comments should have usernames displayed so should usernames be displayed on canvas and in memebrs dropdwon not using identityID as then we dont know who the fuck is who.
9. Save as png or as svg or as project .mero-design does not work in tauri.
10. Comments are overlaying the navbar dropdowns ,e.g. i have options dropdown and comments are on top of it instead of behind it.
11. Images are not being embedded into html exports in code exports in prototype tag
12. In project settings we should also replace identityID's with usernames we gave first time we join the project, this should maybe be saved in logic
13. Use svg icon for bundle also for logos inside the application and as favicon.ico and metadata.
14. Ability to add rounded corners on rectangles and such
15. Go check online what figma has and what is missing here and implement more features here additonally even include it in logic and frontend and tests
