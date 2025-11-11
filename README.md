# Civilization V Replay Viewer for Community Patch/Vox Populi

** Compatible with Community Patch/Vox Populi - not tested on Civ5Replay files created by vanilla Civilization V**
Drag a .Civ5Replay file onto the page to load a replay: https://civitas-john.github.io/vox-deorum-replay/.

You can also [direct link](http://aiwebb.github.io/civ5replay/?file=hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay&turn=177) a URL with a Dropbox file ID included to easily share replays with others.

The project is built on Alex Webb's [civ5replayer](https://github.com/aiwebb/civ5replay).

## Keyboard Shortcuts

Key            | Action
-------------- | ------------
`space`        | Play/pause
`1` - `5`      | Set speed
`←`, `→`       | Back/forward one turn
`↑`, `↓`       | Back/forward ten turns
`pgup`, `home` | Jump to first turn
`pgdn`, `end`  | Jump to last turn
`+`, `-`       | Zoom in/out

## Query Parameters

#### turn

Pass a `turn` parameter to automatically start on that turn.

#### file

Pass a `file` parameter to link directly to a .Civ5Replay file hosted on Dropbox. This should be the portion of the sharing URL that is unique to the file. For example, if the sharing URL is

    https://dl.dropboxusercontent.com/1/view/hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay

then the `file` parameter would be `hrbho1q4dtro8pa/Ramesses%20II_0267%20AD-1987_42%20(9).Civ5Replay`.

## Acknowledgement
- Alex Webb - [civ5replayer](https://github.com/aiwebb/civ5replay)
- Kristoffer Berdal - [flexd/replay_parser](https://github.com/flexd/replay_parser)
- Danny Fisher - [CivFanatics thread](http://forums.civfanatics.com/showthread.php?t=388160)
- Vox Populi Community - [Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL)