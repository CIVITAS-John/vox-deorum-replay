# Frontend redesign plan

Status: draft for revision. This document keeps the proposed stages, UI mockups, and open decisions together. Implementation will happen one stage at a time. This draft makes no code changes and leaves framework and rendering library choices for implementation.

## Overall direction

Make the map the center of the experience, with a clear timeline, useful inspection, and a separate space for statistics. Keep some Civilization character through restrained colors and typography, while giving controls and content more room to breathe.

The current viewer combines a map, playback controls, and an event log. It loads replay and save files, and already reads statistics datasets. Save files also supply river edges, which are not yet drawn. Richer city, economy, and diplomacy details still need further parser work.

Use three main destinations: **Map**, **Events**, and **Statistics**. On larger screens, events and inspection can sit beside the map. On phones, each destination gets usable space, with map details opening in a bottom sheet. Changing destinations preserves the selected turn and civilization.

Treat these as distinct views of the game:

- **Replay history:** information that can be shown at the selected turn.
- **Saved position:** extra details known at the turn of the loaded save.
- **End-game summary:** the final recorded position and available results. An unfinished save should say “Summary at turn ...” instead of implying that the game has ended.

Saved-position details must not silently appear as historical facts when the timeline moves backward. Replay files should remain useful without save-only information.

## Stage 1: Refactor the frontend foundation

**Goal:** make later UI, map, and statistics changes easier to develop independently.

Separate the responsibilities for opening a game, navigating turns, drawing the map, browsing events, and presenting statistics. Give these areas a shared understanding of the current game, turn, and selection, so they stay in sync as the layout changes.

Make the difference between historical data, saved-position data, and missing data clear to the frontend. New map layers or statistics should be able to use additional parser results without requiring another broad reorganization.

Preserve file opening, drag and drop, shared file links, starting-turn links, playback shortcuts, event filters, and event-to-map interactions. Keep the visible experience stable during this stage.

**Ready to move on when:** existing replay and save examples still work, and the map, events, and future statistics view can evolve separately.

**Decision to revisit:** how much of the current UI and map code is worth retaining. Choose this during implementation, based on the later stages rather than a preference for a particular framework.

## Stage 2: Build a responsive application layout

**Goal:** make opening and exploring a game comfortable on desktop, tablet, and phone.

Add an obvious Open file action and a welcoming empty state, with clear loading and error feedback. Use a compact header, readable text, consistent controls, and a persistent timeline while exploring history. Keep filters and less frequent actions in panels that can close.

Desktop layout:

```text
+--------------------------------------------------------------------+
| Vox Deorum Replay     Game name                         [Open file] |
| [Map]  [Events]  [Statistics]                       Turn 180 / 320   |
+---------------------------------------------+----------------------+
| [Layers]  [Civilizations]                    | [Events] [Inspect]   |
|                                             |                      |
|                                             | Filter: All events   |
|                    MAP                      |                      |
|                                             | Turn 180             |
|                                             | A city was founded   |
|                                             |                      |
|                          [+] [-] [Fit map]   | Select for details   |
+---------------------------------------------+----------------------+
| [First] [Back] [Play] [Next]   o-------------   [Turn 180] [Speed 1x] |
+--------------------------------------------------------------------+
```

Phone layout:

```text
+--------------------------------+
| Vox Deorum Replay       [Open] |
| [Map] [Events] [Statistics]    |
+--------------------------------+
| [Layers]       [Civilizations] |
|                                |
|              MAP               |
|                                |
|              [+] [-] [Fit map] |
+--------------------------------+
| Turn 180 / 320       [Go to...] |
| o----------------------------  |
| [Back] [Play] [Next] [Speed]    |
+--------------------------------+
```

On phones, Events and Statistics occupy the main content area. Tapping a city or tile opens a dismissible details sheet. On tablets and in landscape, show the side panel only when enough map space remains. Resizing should preserve the place the user is exploring.

Support touch panning and zooming, large tap targets, keyboard navigation, visible focus, and labels that do not rely on color alone. Keep essential information available by tap or selection, rather than requiring hover.

**Ready to move on when:** a user can open a file, navigate turns, filter events, and inspect the map on a narrow phone screen without page-wide horizontal scrolling.

**Decision to revisit:** the amount of Civilization ornamentation. The proposed default is a quiet, modern frame around a visually rich map.

## Stage 3: Improve the 2D map renderer and add rivers

**Goal:** create a clearer, smoother map that can support more detail later.

Improve the rendering foundation for responsive panning, zooming, and playback on large maps, including mobile devices. Evaluate retaining or replacing the current renderer against these outcomes. Keep the map two-dimensional.

Draw connected rivers along the correct hex edges from save data. Make their junctions and coast connections readable, and keep rivers distinguishable from civilization borders. Check continuity across the map seam where wrapping applies.

Establish a consistent visual treatment for terrain, hills, mountains, forests, natural wonders, cities, and borders. At a distant zoom, emphasize geography and territory. Reveal more labels and detail as the user zooms in.

```text
+---------------------------------------------+
| [Layers]                        [Fit map]   |
| +------------------+                        |
| | [x] Terrain      |     ^ ^    ~           |
| | [x] Rivers       |    ^ ^    ~~~          |
| | [x] Borders      |          ~   * City    |
| | [x] Cities       |         ~              |
| | [ ] Hex grid     |       ~~~              |
| +------------------+     ~                 |
| Legend: ^ mountains   ~ river   * city      |
+---------------------------------------------+
```

The sketch shows visual priority, not river geometry. The actual map follows hex edges. Offer the river layer when the file supplies it; otherwise explain “Rivers are available from save files.” Treat rivers from a save as saved-map geography unless their historical validity is established.

**Ready to move on when:** rivers are continuous and correctly placed, borders and cities remain legible, and representative large games are comfortable to explore on desktop and phone.

**Decision to revisit:** terrain style, such as textured tiles or a cleaner illustrated appearance. Compare small visual samples before committing to a full asset refresh.

## Stage 4: Add richer map inspection

**Goal:** let users understand a position through the map, starting with the information already available.

Introduce city and tile inspection, civilization highlighting, and a compact legend. Begin with terrain, rivers, and the city and ownership information already supported. Add resources, improvements, routes, city population, and other details only as the parsers make them reliable.

Default richer save-only layers to the saved position. If the loaded file represents a finished game, this becomes the end-game map. Keep a clear route back to replay history, and explain why some layers disappear there.

```text
+--------------------------------------------------------------------+
| [Replay history] [Saved position: turn 320]                          |
+---------------------------------------------+----------------------+
| [Layers]  [Highlight: Rome]                  | Rome                 |
|                                             | City at turn 320     |
|                MAP                          | Owner:  Rome          |
|          selected city (*)                  | Terrain: grassland   |
|                                             | River nearby: yes    |
|                                             |                      |
|                                             | [Show city events]   |
+---------------------------------------------+----------------------+
```

On phones, the same information appears in a bottom sheet with a Close action. Selecting an event with a known location focuses the map; inspecting a city can open its relevant history. Keep optional overlays off until requested so the map stays readable.

**Ready to move on when:** users can inspect a city or tile, understand which turn its details describe, and move between inspection and events without losing context.

**Decision to revisit:** which additional layers are most useful. Resources, improvements, and routes are initial candidates. Units and more detailed city views remain open until their data and visual value are clearer.

## Stage 5: Introduce statistics and expand the end-game summary

**Goal:** make the available numbers useful now, while leaving room for richer results later.

Start with the datasets already read from replay and save files. Confirm which measures have reliable names, units, player associations, and turn coverage before presenting them. Offer a summary at the last recorded turn, a comparison table, and a chart for one chosen measure over time.

```text
+--------------------------------------------------------------------+
| [Map] [Events] [Statistics]                                         |
| Summary at turn 320                [Overview] [Trends] [Compare]    |
+--------------------------------------------------------------------+
| Available measures: [Score] [Cities] [More...]                       |
|                                                                    |
| Civilization       Score at turn 320       Cities at turn 320       |
| Rome                    ...                        ...              |
| Egypt                   ...                        ...              |
|                                                                    |
| Measure: [Score v]                   Players: [Rome] [Egypt]        |
| Value                                                              |
|   |                            ....                                |
|   |              ..............                                    |
|   |    ..........                                                  |
|   +---------------------------------------------------- Turn       |
|                                                                    |
| [View selected turn on map]                                        |
+--------------------------------------------------------------------+
```

Measures and values in this mockup are illustrative and depend on the file. On phones, stack the summary and chart, and use a compact comparison list. Provide readable values alongside charts so comparison does not depend on interpreting lines or colors.

Separate unavailable data from zero, and avoid presenting a missing final value as a current result. Label incomplete histories. Only show a winner or victory type when the file provides a reliable result.

Further statistics are an open extension of this stage. Possible areas include economy, science, culture, military strength, city development, and diplomacy. Choose the questions users want answered first, then identify the parser work needed for each. A current save snapshot can support a final comparison without supporting a historical chart.

**Ready to move on when:** users can compare civilizations using trustworthy existing datasets and connect a chart turn to the map. Parser-dependent additions can follow as separate increments.

**Decision to revisit:** which two or three end-game questions deserve the next parser work, for example “Who led in science?” or “How did each empire develop its cities?”

## How to revise and carry out this plan

Edit each stage and its mockups here as decisions settle. Keep this as the single design draft rather than splitting layouts and open questions into separate documents.

The proposed order is foundation, responsive layout, renderer and rivers, richer inspection, then statistics. The first statistics increment could move ahead of richer inspection if the existing datasets offer more immediate value. Parser expansion should not hold up the responsive layout or river rendering.

Before implementing each stage, settle its open design choices and narrow its first deliverable. Review the result using replay and save examples on desktop and phone before starting the next stage.
