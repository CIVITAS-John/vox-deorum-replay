# Civilization V Replay Viewer for Community Patch/Vox Populi

This web-based replay viewer allows you to watch your Civilization V replays. Watch empires rise and fall, see borders shift over centuries, and relive your most epic games. The viewer is specifically designed for the [Community Patch / Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) mod and may not work correctly with vanilla replay files.

Designed to work with the [Vox Deorum project](https://github.com/CIVITAS-John/vox-deorum), a modmod that enables LLMs to play Vox Populi with you or with themselves.

![Replay Viewer in Action](examples/replay-demo.gif)

## How to Use

Visit the viewer at: https://civitas-john.github.io/vox-deorum-replay/

In those examples, Player 0 is an LLM. You can see how they play and reason throughout the game.
- [Example save 1](https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/examples/1.Civ5Replay)
- [Example save 2](https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/examples/2.Civ5Replay)
- [Example save 3](https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/examples/3.Civ5Replay)

### Option 1: Drag and Drop
Simply drag your `.Civ5Replay` file from your computer and drop it onto the webpage. The replay will load automatically and you can use the playback controls or keyboard shortcuts to navigate through the game.

### Option 2: Direct Link
Share replays with others by linking directly to a hosted replay file. Add the `file` parameter with the full URL to your replay:
```
https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/examples/1.Civ5Replay
```
You can also specify a starting turn with the `turn` parameter:
```
https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/?file=https://civitas-john.github.io/vox-deorum-replay/examples/1.Civ5Replay&turn=150
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