# 《别让 AI 转正》Cocos 灰盒工程

This folder is based on the Cocos Creator 3.8.8 `empty-2d` template.

Open it with:

```bash
open /Applications/Cocos/Creator/3.8.8/CocosCreator.app
```

Then choose this folder as the project:

```text
/Users/denny/Documents/feiga/cocos/ai-office
```

Current status:

- Project shell is created from the official empty 2D template.
- Core gameplay rules are still maintained in `scripts/sim/sim.ts`.
- The web greybox lives in `prototype/`.
- `assets/scripts/GameRoot.ts` can auto-generate the greybox UI at runtime.

## Fast setup in Cocos Creator

1. Open the project in Cocos Creator 3.8.8.
2. Open the default scene.
3. Select `Canvas`.
4. In the Inspector, add the `GameRoot` component from `assets/scripts/GameRoot.ts`.
5. Click Preview.

You do not need to manually create labels, buttons, progress bars, or drag property bindings. The script creates the current greybox nodes under `Canvas` when the scene starts.

The Codex sandbox cannot launch the Cocos Electron binary, so scene creation must be done in the Cocos UI or from a normal terminal/session.
