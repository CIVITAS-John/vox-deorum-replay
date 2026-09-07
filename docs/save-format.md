# Save file format notes

These notes describe what this repo learned about Civilization V save files (Vox Populi and Vox Deorum mod sets) and how the parser in `src/parsers/save-parser.ts` reads them. They are written for developers; players do not need any of this. The layout statements below were cross checked against the game DLL source that lives next to this repo, mainly `CvPlot.cpp`, `CvMap.cpp`, `CvSerialize.h`, and the FireWorks serialization headers, and every claim is locked in by the regression tests in `tests/parsers/save-parser.test.ts`.

## The two file types

- A `.Civ5Replay` file is uncompressed and holds the finished game: header, civilizations, dataset tables, the event log, and the map terrain. It is the ground truth the save parser is tested against.
- A `.Civ5Save` file is a live game state. It carries the same replay content (events, datasets) plus everything else the game needs, and its body is compressed.

## Compression

The save starts with a small uncompressed part: an engine header and the whole pregame section (game setup, civs, mods). Then comes a compression marker (int32 value 2 followed by an int32 chunk size hint) and the compressed body.

The writer does not write one plain zlib stream. It slices its deflate stream into 64KB chunks and appends a four byte little endian size word after every chunk. The last chunk is followed by nothing, but a word holding the final chunk size is placed before it, so a size word appears between every pair of chunks. Reading those words as compressed data corrupts the stream in periodic patches, which is what the very first version of the inflater did.

`src/utils/inflate.ts` validates and strips the chunk words before inflating. A payload without valid chunk words is inflated as a plain stream, so other zlib inputs keep working. Two quirks survived into the fixtures: the final size word can disagree with the actual trailing bytes by a few bytes (the stream still ends cleanly), and the writer terminates the stream with a sync flush, so the inflater appends a final empty block before decoding.

## Decompressed body layout

In order:

- The game section. A fixed prelude with save version, build strings, turn counters, the start year, and the victory result (below). Then the event log, which sits near the start of the section. Then one replay data cluster per player slot, each holding the dataset series (scores, city counts, and so on) under `REPLAYDATASET_` names.
- An embedded SQLite database, preceded by a four byte size word. The parser only needs it as a landmark: the map section starts right behind it.
- The map section (below).
- The per player sections (below).

## Game section prelude and the victory result

The prelude follows `CvGame::Serialize` in the game DLL. In order: an int32 save version (always 0), a 16 byte game data hash, a length prefixed core version string, then `m_iEndTurnMessagesSent`, `m_iElapsedGameTurns` (the save's turn), `m_iStartTurn`, `m_iWinningTurn`, and `m_iStartYear`, all int32.

Every field from there to the victory block has a fixed size, so the parser walks straight on: 28 int32s (turn estimates, slice counters, city and population totals, score counters), six bool bytes, an int32 observer override, five bool bytes, then a counted set of advisor message hashes (the count is 0 in the example games and each hash is four bytes). Behind it sit four int32s (handicap, pause player, AI auto play return player, best land unit) and then the victory block, all int32:

- `m_eWinner`, the winning team, -1 when nobody has won.
- `m_eVictory`, the index into the mod's Victories database table, -1 when none. The index has no stable meaning across mod versions, so the victory message in the event log is the readable source.
- `m_eGameState`: 0 while the game runs, 1 when it is over, 2 when playing on after the end. The example save of the finished game stores 2.

`m_iWinningTurn` stays 0 until someone wins, so 0 means no result. The parser exposes the raw fields plus a `reliable` flag, and a result counts as reliable only when the header claims a winner (winning turn past the start, victory and winner set, game state past running) and the event log confirms it with a victory message at exactly the winning turn. The message's author becomes the winner civilization. The interface may present a winner only when the result is reliable.

A save taken before the game was won carries no result at all, so such a save can never prove one. The viewer therefore also accepts a winner asserted through the `winner` parameter of a shared link, resolved in `src/ui/annotations.ts`: a plain number addresses the civilization like the `playerN` annotations do, anything else must be one of their labels. The result is marked as link sourced, the header attributes it to the link, and it never overrides a result the file proved itself.

## Map section

- A 47 byte header: width, height, land plot count, owned plot count, natural wonder count, top and bottom latitude (all int32), wrapX and wrapY flags, a 16 byte map GUID, and a generated flag. The parser reads all of it except the GUID and exposes it as the map header; the wrap flags tell Stage 4 whether wrapped panning applies. The example maps wrap horizontally and not vertically.
- Two resource count tables, one int32 per resource type each. The number of resource types depends on the mod set, 60 in the example games, so both tables together take 480 bytes there.
- The plot records, one per plot, written row by row: height rows of width records, row major.
- Behind the plots: the area, landmass, continent, and river lists, then an unused AI map hints value. The parser stops after the plot array and does not read these. Each list is a count followed by records. An area record holds counters, boundary edges, water and mountain flags, and nine sparse per player or per resource tables. A landmass record holds an id, tile count, centroid, water flag, continent type, and area ids. A continent record holds an id, tile count, centroid, and land flag. A river record holds only an id and the list of plot indices the river flows through: 65 rivers in the example games, of which 64 appear on plot edges.

## Plot record layout

The record layout follows `CvPlot::Serialize` in `CvPlot.cpp` exactly. In order:

- A prefix of small counters: area, ownership, improvement, and upgrade durations (int16), five int8 counters (among them the resource count of the plot), landmass and continent (int16).
- The river id list: a count word, then one int32 river id per hex direction. The count is always 6, because the game fills all six directions with -1 for edges without a river; the parser additionally accepts the all ones value as an empty list, which the writer never produces.
- A packed flag word (uint16), five int8 experience counters, then owner, plot type, and terrain type as int8 each. Feature, resource, and improvement follow as int32 each, because those three are written through the full enum serializers.
- Eight int8 player responsibility fields, route type (int8), unit increment (int16), world anchor and its data (int8), three river flow directions (int8), a city flag, two owning city id pairs (int32 each), and seventeen yield bytes.
- The team visibility block: 64 teams times 16 bytes. Each entry holds four small counters, a reveal flag, revealed improvement and route types as int32 each, and three more flags.
- The revealed bits: 256 bytes. The DLL sizes the underlying array by bits instead of words (a quirk of `PlotBoolField` in `CvPlot.h`), which is why it is four times larger than the player count needs.
- The tail: a river crossing byte, optional script data behind a flag byte, the build progress map (count plus build type and progress pairs), two invisible visibility vectors (the second holds a counted int vector per team), and the unit list (count plus owner and unit id pairs). The count words are plain sizes, zero when empty; the parser also accepts the all ones value defensively.
- Closing fields: continent type, five archaeology enums (int32 each), a trade route counter (int32), the last build turn (int16), and the spawned resource position (two int16).

The shortest possible record, every variable part empty, is 1422 bytes. Records grow with river ids, build progress, invisible visibility entries, and units. In the example games every record also carries 14 invisible visibility team entries, which adds a constant 280 bytes.

Beyond the terrain, the parser reads the snapshot fields of each record: the owner (player slot, -1 when unowned), resource, improvement, route, the city flag, and the owning city pair. These describe the game state at the save's turn only, so they carry the snapshot kind in the viewer's data model.

## Rivers

Each plot stores six river ids, one per hex edge, in the direction order NE, E, SE, SW, W, NW. A value of -1 means the edge has no river; any other value is the id of the river that crosses that edge, indexing the river list stored behind the plot array.

The example maps carry 64 river ids across 479 plots and 1060 directed edge records. Opposite-direction totals agree (NE with SW, E with W, SE with NW), but those totals do not prove every neighboring plot stores a duplicate. Geometry checks on example 4 find 1054 records paired with matching neighbors and six river-id-15 records facing plot (57,11) whose opposite records are absent.

Lakes are encoded as shoreline rivers. Each lake body owns one river id and every lake plot stores that id on all six of its edges, and the surrounding land plots mirror it on their facing edges like any river bank. Example 4 holds 11 lake bodies, and their ids consume 528 of the 1060 directed records. The game itself paints water there instead of rivers, so the renderer keeps an edge supplied by either plot but drops every edge that touches water terrain (coast, ocean, or a lake stored as coast), leaving 353 drawable edges.

Replay files store no river data. The parser attaches the river id array to every tile it reads from a save (`rivers` on the tile objects). Tests check direction totals, neighboring geometry, the known unpaired records, and horizontal seam segments. `src/map/hex-geometry.ts` builds the shared edges, and `src/map/viewport-layer.ts` draws them at every turn.

## How the parser reads the terrain

`extractMapTerrain` in `src/parsers/save-parser.ts` decodes records structurally, no scanning or heuristics: it reads the exact layout above and stops the moment any count word looks implausible.

The first record sits behind the resource tables, whose size depends on the mod set. The parser tries every possible table size from the largest down and accepts the first candidate that decodes as a plausible terrain head and chains cleanly across the whole map. Scanning downward matters: table bytes can masquerade as a record head when a resource count happens to mimic a river count and shifts the field base onto the real record, but such an alias always sits before the true start, so the deepest candidate that chains is the real first record.

A coverage gate protects against saves from other game versions: if the walk decodes fewer than 90 percent of the plots, the terrain is dropped and the map renders blank hexes instead of wrong terrain, with a warning in the console. Cities, borders, and event highlights keep working regardless.

## Per player sections

One section per player slot, in slot order, behind the map section. The parser does not read them; this survey comes from the game DLL source (`CvPlayer::Serialize`, `CvCity::Serialize`, `CvDiplomacyAI::Serialize`) and names what a future expansion would find.

The player section is a long run of about 470 flat scalar and array fields (yield modifiers, great person counters, happiness, espionage, economic values), then 26 sub objects in a fixed order (policies, economic, military, grand strategy, diplomacy, religion, corporations, techs, trade, culture, and friends), notifications, the treasury, the research queue, the city name list, the city list, the unit list, armies, AI operations, the replay data of the slot, and a tail of yield modifier containers. Three sub objects serialize empty (religion AI, homeland AI, deal AI). Reaching a specific block means walking everything before it, and several arrays are sized by the mod's database (resources, building classes, techs), so the decode cost of anything inside is medium to heavy.

City records: each city writes owner (int32), x and y, its id, rally point, founding turn, acquired turn, population, food stores, damage, puppet and razing flags, previous and original owner, its name, the building spans (eight int32 arrays with one entry per building type in the database, among them the turn each building was built), the production queue, and sub objects for strategy, citizens, religion, espionage, and yields. Everything is current state or a single timestamp (founding turn, per building build turns); no city field carries per turn history.

Diplomacy: the diplomacy block holds this player's view of every other player, about 150 arrays per player: opinions, approaches (guarded, wary, hostile), friendship and denouncement turns, coop war states, war progress, peace treaty willingness, promises with turn stamps, and event counters (cities liberated, times nuked). All of it is current state or single turn stamps, never a series. War and peace themselves live in the team sections.

The per turn history verdict for the whole per player area: the only series are the slot's replay data, which duplicates the dataset clusters the game section already carries, and `m_vviYieldHistory`, six per turn yield series (production, gold, science, culture, tourism, golden age points) that duplicate the datasets as well. Nothing else records history. A save therefore adds snapshot detail only; the datasets remain the sole per turn numeric history, which is why the viewer's statistics build on them.

## Ground truth

For both example games the save parser output matches the replay file exactly:

- Every event matches, except seven barbarian events that the replay exporter misattributes to the first player; the parser keeps them unattributed.
- Every civilization's dataset tables match byte for byte (the mid game save matches the replay up to its snapshot turn).
- Every terrain tile matches, elevation, terrain type, and feature, all 4187 plots of the 79 by 53 map.

The snapshot fields, which replay files do not carry, are checked against invariants and against the event log at the save's turn:

- The map header's owned plot count equals the number of plot records with an owner: 2740 in the finished game, 2526 in the mid game save.
- Ownership folded from the event log agrees with every plot in both saves, including five tiles released around Rapa Nui and fifteen around Belo Horizonte. The event processor preserves claims without a known civilization so the fold can clear previous ownership. These events do not remove a city; a separate razing event does that.
- The city flags land exactly on the cities the event fold keeps alive, coordinate for coordinate (79 and 82 cities), and every city plot's owning city belongs to the plot owner.
- The victory block of the finished game (winning turn 484, winner team 6, cultural victory) matches the victory message in the event log at the same turn; the mid game save reports no result.

The earlier belief that the mod transforms the polar regions on load, and that the save stores zeroed or garbled plot records there, was wrong. It was an artifact of the heuristic walker losing its place inside the record array. The saves are clean, and the structural decode reads every record.
