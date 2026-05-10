# IntentEra Chat — VS Code & Cursor extension

A Cursor-style chat panel that answers **"why is this code the way it
is?"** for any file or selection inside your project, by combining your
**local git history** with the team's **Jira tickets** and **GitHub PRs**
through the IntentEra RAG.

## What you get

- A sidebar webview titled **IntentEra Chat**.
- Two right-click commands:
  - **IntentEra: Ask about selection** — adds the active selection (file
    + line range + text) as a context chip.
  - **IntentEra: Ask about this file** — adds the active file (or the
    file you right-clicked in the explorer) as a whole-file context chip.
- A grounded answer with three citation lists: **Commits that shaped
  this**, **Linked Jira tickets**, **Related GitHub PRs**.

## Three pieces

```
+----------+   +-------------------+   +-------------------+
| this VSIX|-->| local git agent   |   | IntentEra /chat   |
| (this    |   | (npm run agent in |   | Lambda + Mongo +  |
|  folder) |-->| the IntentEra     |   | OpenAI            |
+----------+   |   repo)            |   +-------------------+
                +-------------------+
                  ^                   ^
                  |                   |
                  +- 127.0.0.1:8787   +- https://<api-gw>/chat
```

The extension is the only piece you install in your IDE. The other two
boxes are described in
[../docs/code-chat.md](../docs/code-chat.md).

## Install

### Option A — install a packaged VSIX

```bash
# In this folder:
npm install
npm run build
npx @vscode/vsce package
# Then in VS Code or Cursor:
code --install-extension intentera-chat-0.1.0.vsix
# (Cursor uses the same CLI shape: `cursor --install-extension ...`.)
```

### Option B — run from source (Extension Development Host)

```bash
npm install
npm run build
# Open this folder in VS Code or Cursor, hit F5.
```

## Configure

In your IDE settings (`Preferences › Settings › IntentEra`):

| Setting                       | Required | Default                | Description                                         |
|-------------------------------|----------|------------------------|-----------------------------------------------------|
| `intentera.lambdaChatUrl`     | yes      | `""`                   | Your API Gateway URL for the IntentEra `/chat`.    |
| `intentera.lambdaApiKey`      | no       | `""`                   | Sent as `x-api-key` if your endpoint requires it.  |
| `intentera.agentUrl`          | no       | `http://127.0.0.1:8787`| Where the local git agent listens.                  |
| `intentera.maxLocalCommits`   | no       | `50`                   | Cap on commits the agent extracts per request.      |
| `intentera.requestTimeoutMs`  | no       | `60000`                | Lambda call timeout.                                |

The chat panel shows a status banner whenever:

- The Lambda URL is unset, or
- The local agent isn't reachable.

## Run the local git agent

In the IntentEra repo (NOT this folder), once per machine session:

```bash
npm install   # only on first run
npm run agent
```

You'll see `IntentEra local git agent ready at http://127.0.0.1:8787`.

The agent only binds to loopback and never makes outbound network calls;
it shells out to `git log` against your working tree.

## How a chat request flows

1. You select code or a file → run **IntentEra: Ask about …**.
2. A chip appears in the panel; you type a question and hit **Send**
   (or `Cmd/Ctrl-Enter`).
3. The extension asks the local agent for the commits that touched each
   attachment.
4. The extension POSTs `{question, commits, attachments, history}` to
   the Lambda.
5. The Lambda runs multi-query RAG over Jira + GitHub vector stores and
   asks OpenAI to compose the answer + grounded citations.
6. The panel renders the answer plus **Commits that shaped this**,
   **Linked Jira tickets**, and **Related GitHub PRs**.

## Privacy

See [../docs/code-chat.md](../docs/code-chat.md#privacy--data-flow). In
short: file contents and commit metadata are sent through the Lambda to
OpenAI; diffs are never sent.

## Develop

```bash
npm install
npm run watch    # esbuild --watch
npm run build    # one-shot
```

The webview is plain HTML/CSS/JS in `media/`; the extension host is
TypeScript in `src/` bundled to `dist/extension.js` by esbuild.
