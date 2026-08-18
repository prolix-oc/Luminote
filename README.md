# Luminote

Luminote is an Obsidian-style vault workspace extension for Lumiverse. It was created by **Coffee** from the Lumiverse Discord server and is published by Prolix OCs with her authorship preserved.

## Original author

Coffee created Luminote, shaped its original product and implementation, and made it available to the Lumiverse community despite being too shy and stubborn to publish it herself — **2 shy to upload it to GitHub, or perhaps even to have a GitHub account.** Every Luminote release must retain this attribution:

> Original extension by Coffee (Lumiverse Discord). Published by Prolix OCs.

See [CREDITS.md](CREDITS.md) for the complete release attribution.

## Development

Install dependencies with `bun install`, then validate a release with:

```sh
bun run release:check
```

This type-checks the source, produces `dist/backend.js` and `dist/frontend.js`, and confirms the Lumiverse manifest is complete, version-aligned, and references the built entry points.

## Releasing

1. Update the shared version in `package.json` and `spindle.json`.
2. Run `bun run release:check`.
3. Publish the project directory with `spindle.json` and the generated `dist/` directory included. Do not include `node_modules/`.
4. Preserve Coffee's original-author attribution in the release listing and any accompanying announcement.

Luminote requests `app_manipulation`, `ui_panels`, `images`, `media`, and `ephemeral_storage` permissions. Its dynamic-code-execution capability declaration is required by bundled dependencies that can trigger Lumiverse's static scanner.
