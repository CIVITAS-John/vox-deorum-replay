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

- The game section. A fixed prelude with save version, build strings, turn counters, and the start year. Then the event log, which sits near the start of the section. Then one replay data cluster per player slot, each holding the dataset series (scores, city counts, and so on) under `REPLAYDATASET_` names.
- An embedded SQLite database, preceded by a four byte size word. The parser only needs it as a landmark: the map section starts right behind it.
- The map section (below).
- The per player sections (units, cities, diplomacy). The parser does not need them.

## Map section

- A 47 byte header: width, height, land plot count, owned plot count, natural wonder count, top and bottom latitude (all int32), wrapX and wrapY flags, a 16 byte map GUID, and a generated flag.
- Two resource count tables, one int32 per resource type each. The number of resource types depends on the mod set, 60 in the example games, so both tables together take 480 bytes there.
- The plot records, one per plot, written row by row: height rows of width records, row major.
- Behind the plots: the area, landmass, continent, and river lists, then an unused AI map hints value. The parser stops after the plot array and does not read these.

## Plot record layout

The record layout follows `CvPlot::Serialize` in `CvPlot.cpp` exactly. In order:

- A prefix of small counters: area, ownership, improvement, and upgrade durations (int16), five int8 counters, landmass and continent (int16).
- The river id list: a count word, then one int32 river id per hex direction. An empty list is written as the all ones value instead of a zero count.
- A packed flag word (uint16), five int8 experience counters, then owner, plot type, and terrain type as int8 each. Feature, resource, and improvement follow as int32 each, because those three are written through the full enum serializers.
- Eight int8 player responsibility fields, route type (int8), unit increment (int16), world anchor and its data (int8), three river flow directions (int8), a city flag, two owning city id pairs (int32 each), and seventeen yield bytes.
- The team visibility block: 64 teams times 16 bytes. Each entry holds four small counters, a reveal flag, revealed improvement and route types as int32 each, and three more flags.
- The revealed bits: 256 bytes. The DLL sizes the underlying array by bits instead of words (a quirk of `PlotBoolField` in `CvPlot.h`), which is why it is four times larger than the player count needs.
- The tail: a river crossing byte, optional script data behind a flag byte, the build progress map (count plus build type and progress pairs), two invisible visibility vectors (the second holds a counted int vector per team), and the unit list (count plus owner and unit id pairs). Every count word can also be the all ones empty marker.
- Closing fields: continent type, five archaeology enums (int32 each), a trade route counter (int32), the last build turn (int16), and the spawned resource position (two int16).

The shortest possible record, every variable part empty, is 1422 bytes. Records grow with river ids, build progress, invisible visibility entries, and units. In the example games every record also carries 14 invisible visibility team entries, which adds a constant 280 bytes.

## Rivers

Each plot stores six river ids, one per hex edge, in the direction order NE, E, SE, SW, W, NW. A value of -1 means the edge has no river; any other value is the id of the river that crosses that edge, indexing the river list stored behind the plot array.

Two facts make the data trustworthy: every river edge separates two plots, and both plots store the same id for it from their own side, so the per direction edge counts pair up (NE with SW, E with W, SE with NW). The example maps carry 64 rivers across 479 plots and 1060 river edges.

Replay files store no river data. The parser therefore attaches the river id array to every tile it reads from a save (`rivers` on the tile objects), and the tests verify the pairing invariant instead of a replay comparison. Rendering the rivers on the map is still open.

## How the parser reads the terrain

`extractMapTerrain` in `src/parsers/save-parser.ts` decodes records structurally, no scanning or heuristics: it reads the exact layout above and stops the moment any count word looks implausible.

The first record sits behind the resource tables, whose size depends on the mod set. The parser tries every possible table size from the largest down and accepts the first candidate that decodes as a plausible terrain head and chains cleanly across the whole map. Scanning downward matters: table bytes can masquerade as a record head when a resource count happens to mimic a river count and shifts the field base onto the real record, but such an alias always sits before the true start, so the deepest candidate that chains is the real first record.

A coverage gate protects against saves from other game versions: if the walk decodes fewer than 90 percent of the plots, the terrain is dropped and the map renders blank hexes instead of wrong terrain, with a warning in the console. Cities, borders, and event highlights keep working regardless.

## Ground truth

For both example games the save parser output matches the replay file exactly:

- Every event matches, except seven barbarian events that the replay exporter misattributes to the first player; the parser keeps them unattributed.
- Every civilization's dataset tables match byte for byte (the mid game save matches the replay up to its snapshot turn).
- Every terrain tile matches, elevation, terrain type, and feature, all 4187 plots of the 79 by 53 map.

The earlier belief that the mod transforms the polar regions on load, and that the save stores zeroed or garbled plot records there, was wrong. It was an artifact of the heuristic walker losing its place inside the record array. The saves are clean, and the structural decode reads every record.
