# Civilization V Replay Viewer for Community Patch/Vox Populi

This web-based replay viewer allows you to watch your Civilization V replays. Watch empires rise and fall, see borders shift over centuries, and relive your most epic games. The viewer is specifically designed for the [Community Patch / Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) mod and may not work correctly with vanilla replay files.

Designed to work with the [Vox Deorum project](https://github.com/CIVITAS-John/vox-deorum), a modmod that enables LLMs to play Vox Populi with you or with themselves.

![Replay Viewer in Action](examples/replay-demo.gif)

## How to Use

Visit the viewer at: https://vox-deorum.github.io/vox-deorum-replay/

The bundled examples are playthroughs by language models: each file is named after the model that drove the civilizations with decision-making trails (visible strategy changes and reasoning in the event log).
- [Claude-5-Opus](https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/Claude-5-Opus.Civ5Save&model=Claude-5-Opus)
- [GLM-5.2](https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/GLM-5.2.Civ5Save&model=GLM-5.2)
- [GPT-5.6-Sol](https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/GPT-5.6-Sol.Civ5Save&model=GPT-5.6-Sol)
- [Qwen-3.8-27B](https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/Qwen-3.8-27B.Civ5Save&model=Qwen-3.8-27B)

### Option 1: Drag and Drop
Simply drag your `.Civ5Replay` file from your computer and drop it onto the webpage. The replay will load automatically and you can use the playback controls or keyboard shortcuts to navigate through the game.

### Option 2: Direct Link
Share replays with others by linking directly to a hosted replay file. Add the `file` parameter with the full URL to your replay:
```
https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/Claude-5-Opus.Civ5Save
```
The viewer keeps the address bar in sync while you explore, so copying the URL at any point shares the exact view. These parameters are available:

Parameter   | Meaning
------------| --------
`file`       | Full URL of a hosted `.Civ5Replay` or `.Civ5Save` file to load on open
`turn`       | Starting turn, kept in sync as you move through the timeline
`view`       | Which destination is active: `map` (default) or `events`
`player0` … `playerN` | Annotation for a civilization, see "Annotating Civilizations" below
`model`      | Label for every civilization with decision-making trails, see "Marking the Model" below
`winner`     | The winning civilization, for files that cannot prove the result, see "Sharing the Winner" below

### Annotating Civilizations

When sharing a game between LLMs or specific players, you can label each civilization through the address bar. Player numbering starts at zero, so `player0` annotates the first civilization in the file, `player1` the second, and so on:
```
https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/GLM-5.2.Civ5Save&player0=Qwen&player1=GLM
```
The annotations appear in the header ("Rome: Qwen · Egypt: GLM") and next to civilization names in the event log. They are display labels only: they rename civilizations in the interface but change no data.

### Marking the Model

A model-driven civilization leaves decision-making trails: the strategy change events it records while playing. The `model` parameter labels every civilization that left such trails with the model's name, whatever player number it sits at, so one parameter covers games where the model's seat changes:
```
https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/Claude-5-Opus.Civ5Save&model=Claude-5-Opus
```
Here the two civilizations with strategy events are marked "Claude-5-Opus" in the header and the event log. A `playerN` annotation always wins for the civilization it names, so you can single out one seat while the model parameter covers the rest. Opening a bundled example sets this parameter for you, and a copied link keeps it.

### Sharing the Winner

The viewer presents a winner only when it can trust the result. A finished save proves it on its own: the file's header and its event log agree, and the header line shows the winner without any parameters.

A save taken before the game was won, for example one turn before the end, carries no proof of the result, so the viewer shows no winner on its own. The `winner` parameter lets the sharer pass the result externally. It accepts the civilization number, numbered like the annotations above, or one of the annotation labels, including a `model` label. These illustrative links (the values are examples, not the actual result) both name the first civilization with decision-making trails, the seventh in the file:
```
https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/GLM-5.2.Civ5Save&model=GLM-5.2&winner=GLM-5.2
https://vox-deorum.github.io/vox-deorum-replay/?file=https://vox-deorum.github.io/vox-deorum-replay/examples/GLM-5.2.Civ5Save&winner=6
```

The project is built on Alex Webb's [civ5replayer](https://github.com/aiwebb/civ5replay).

### Where to Find Replay Files?

Civilization V (Vox Populi) replay files are saved with the `.Civ5Replay` extension. You can find them in:

**Windows:**
```
Documents\My Games\Sid Meier's Civilization 5\Replays\
```

**Mac:**
```
~/Documents/Aspyr/Sid Meier's Civilization 5/Replays/
```

**Linux:**
```
~/.local/share/Aspyr-Media/Sid Meier's Civilization 5/Replays/
```

Note: Replay files are only generated if you have "Save Replays" enabled in the game options.

### Keyboard Shortcuts

Key            | Action
-------------- | ------------
`space`        | Play/pause
`1` - `5`      | Set speed
`←`, `→`       | Back/forward one turn
`↑`, `↓`       | Back/forward ten turns
`pgup`, `home` | Jump to first turn
`pgdn`, `end`  | Jump to last turn
`+`, `-`       | Zoom in/out


## Helping Us
All pull requests are welcome. In particular, we need your help to:
- Visualize all VP5 features (e.g., Oasis) and Natural Wonders.
- Create better/higher-quality textures.
- Visualize replay DATA - e.g., gold output per turn for each player.
- Adding tooltips on the map and on individual events.

I am planning to work on some of these, when I get some more time :)

## License

Author: John Chen (with assistance from Claude Code).
Lecturer, University of Arizona, College of Information Science
MIT License (as the project forked from [civ5replayer](https://github.com/aiwebb/civ5replay))

## Acknowledgement
- Alex Webb - [civ5replayer](https://github.com/aiwebb/civ5replay)
- Kristoffer Berdal - [flexd/replay_parser](https://github.com/flexd/replay_parser)
- Danny Fisher - [CivFanatics thread](http://forums.civfanatics.com/showthread.php?t=388160)
- Vox Populi Community - [Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL)