---
title: Smallweb Playground
---

# Smallweb Playground

This is a public shared demo instance of [smallweb](https://smallweb.run) running on fly.io.

> **⚠️ Do not use this instance for anything important.**
>
> The content of this instance will be reset anytime I feel like it.
> Also Since this instance is shared, you should not under any circoomstance put credentials in there!

## Usage

Head to the editor at [vscode.smallweb.live](https://vscode.smallweb.live) to edit existing websites.

To create you own websites, just create a file at `/<your-name>/main.ts`, and paste the following code:

```ts
import { Hono } from 'npm:hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello from smallweb!'))

export default app
```

Then go to `https://<your-name>.smallweb.live`, and see your website live!

You can also access the smallweb cli at [cli.smallweb.live](https://cli.smallweb.live). Go to <https://cli.smallweb.live/ls?json> to run `smallweb ls --json` and see the list of apps in this instance.

The `www`, `cli` and `vscode` apps are readonly, but you can edit all the other apps.

## Example apps

- [excalidraw.smallweb.live](https://excalidraw.smallweb.live) - sources in the `/smallblog` folder
- [smallblog.smallweb.live](https://smallblog.smallweb.live) - sources in the `/excalidraw` folder

If you want to "fork" them, just copy paste the folder.

## View Source

Checkout the github repository at [github.smallweb.live](https://github.smallweb.live).

## Design

- Logos and icons created by [SlumberDemon](https://new.sofa.sh)
