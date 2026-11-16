# OGSM.online for Claude Desktop

A Claude Desktop Extension (`.mcpb`) that lets Claude work with
[OGSM.online](https://ogsm.online) through its API v3, with your own personal
API tokens: canvases, objectives, goals, strategies, indicators, actions,
comments and measurements.

[Nederlands ↓](#nederlands)

## Install

1. Download the latest `ogsm-online-vX.Y.Z.mcpb` from
   [Releases](https://github.com/toolsfactory-nl/ogsm-online-claude-extension/releases).
2. Open the file (double-click it, or drag it onto Claude Desktop), or go to
   **Settings → Extensions** in Claude Desktop and install it from there.
3. Fill in at least one environment in the extension settings (see below) and
   enable the extension.

Claude Desktop runs the extension with its built-in Node.js; nothing else needs
to be installed.

## Create a personal API token

1. Sign in to your OGSM.online environment, e.g. `https://klant.ogsm.online`.
2. Open **My settings** (`/my_settings/account`) and go to **Personal API tokens**.
   The API has to be enabled for your environment; ask your administrator or
   OGSM.online support if the section is missing.
3. Click **New personal API token**, give it a name (e.g. *Claude on my laptop*),
   choose the access and how long it stays valid:
   - **Read only**: Claude can look things up, but cannot change anything.
   - **Read and write**: Claude can also create and update actions, comments,
     objectives, goals, strategies and indicators.
4. Copy the token straight away. It is shown only once; treat it like a password.

A token acts with your own permissions: Claude sees and changes exactly what you
can see and change in OGSM.online.

## Configure environments

The extension settings have 10 slots, each a pair of:

- **Environment N: host**: the full host of the environment, e.g.
  `klant.ogsm.online`, or a dedicated server such as `example.ogsm.online`.
  (`https://` and a trailing path are accepted and stripped.)
- **Environment N: personal API token**: the token for that host. Stored as a
  sensitive value: Claude Desktop stores it securely and masks it in the UI.

Fill as many slots as you need and leave the rest empty. Slot 1 is required.

## Security model

- **You choose the environment, every conversation.** Before Claude does
  anything, it lists the configured environments (host names only, never
  tokens) and asks you which one to work in, even when only one is configured.
  This is enforced by the extension itself, not only by instructions to Claude:
  - every tool other than `list_environments` and `select_environment` refuses
    to run until an environment is selected;
  - `select_environment` hands out a random `environment_session` that is bound
    to the chosen environment and that every other tool must pass. It only
    exists in the conversation where you made the choice, so a new conversation
    has to choose again, and an idle selection expires after 12 hours;
  - switching to another environment takes a new, explicit `select_environment`;
  - the extension never picks an environment automatically;
  - where Claude Desktop supports MCP *elicitation*, the extension also shows
    you a picker with the configured environments (no default) and uses your
    choice, not Claude's.
- **Read versus write.** Use a *Read only* token when Claude only needs to look
  things up. Any change with a read only token is refused by OGSM.online with
  `read_only_token`, and Claude tells you so.
- **Tokens stay on your computer.** They are only sent, as
  `Authorization: Bearer …`, to `https://<host>/api/v3/…` of the environment they
  belong to, and never appear in tool output.

## Tools

| Tool | What it does |
| --- | --- |
| `list_environments`, `select_environment` | Show the configured hosts; select the one you chose |
| `list_canvases`, `list_teams`, `list_users`, `list_statuses` | Read canvases, teams, users and action statuses |
| `list_actions`, `create_action`, `update_action` | Actions on a canvas |
| `list_comments`, `create_comment`, `update_comment`, `delete_comment` | Comments on an action |
| `list_/create_/update_objective(s)` | Objectives (no parent) |
| `list_/create_/update_goal(s)` | Goals (`parent_id` of a goal makes a sub goal) |
| `list_/create_/update_strategy/strategies` | Strategies (no parent) |
| `list_/create_/update_indicator(s)` | Indicators (`parent_id` of a strategy or indicator is required) |
| `list_goal_reports`, `list_indicator_reports` | Measurements of goals and indicators |

Descriptions and comments are HTML; an `<img>` with a base64 data URI as its
`src` is stored as an attachment. Errors from the API (such as 403
`read_only_token` or 422 validation errors) are returned to Claude as readable
messages.

## Development

```bash
npm ci
npm test                 # environment gate, request building (mocked fetch), MCP round trip
npm run validate         # validate manifest.json against the MCPB spec
npm run sync-tools       # after changing tools: copy names/descriptions into manifest.json
```

Run the server by hand with `OGSM_ENV_1_HOST=… OGSM_ENV_1_TOKEN=… node server/index.js`
(it speaks MCP over stdio). There is no build step.

### Release

1. Bump `version` in both `manifest.json` and `package.json`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.

GitHub Actions runs the tests, packs the extension with
`@anthropic-ai/mcpb pack` (production dependencies only) and attaches
`ogsm-online-v0.2.0.mcpb` to a new GitHub Release.

---

## Nederlands

Een Claude Desktop-extensie (`.mcpb`) waarmee Claude via de API v3 met
[OGSM.online](https://ogsm.online) werkt, met je eigen persoonlijke API-tokens:
OGSM's, ambities, doelstellingen, strategieën, KPI's, acties, reacties en
metingen.

### Installeren

1. Download de nieuwste `ogsm-online-vX.Y.Z.mcpb` bij
   [Releases](https://github.com/toolsfactory-nl/ogsm-online-claude-extension/releases).
2. Open het bestand (dubbelklikken, of naar Claude Desktop slepen), of installeer
   het via **Instellingen → Extensies** in Claude Desktop.
3. Vul in de instellingen van de extensie minstens één omgeving in (zie
   hieronder) en zet de extensie aan.

Claude Desktop draait de extensie met de ingebouwde Node.js; je hoeft verder
niets te installeren.

### Een persoonlijk API-token maken

1. Log in op je OGSM.online-omgeving, bijvoorbeeld `https://klant.ogsm.online`.
2. Open **Mijn instellingen** (`/my_settings/account`) en ga naar
   **Persoonlijke API-tokens**. De API moet aanstaan voor je omgeving; vraag je
   beheerder of de support van OGSM.online als dit onderdeel ontbreekt.
3. Klik op **Nieuw persoonlijk API-token**, geef het een naam (bijvoorbeeld
   *Claude op mijn laptop*) en kies de toegang en hoe lang het geldig is:
   - **Alleen lezen**: Claude kan dingen opzoeken, maar niets wijzigen.
   - **Lezen en wijzigen**: Claude kan ook acties, reacties, ambities,
     doelstellingen, strategieën en KPI's aanmaken en bijwerken.
4. Kopieer het token meteen. Je ziet het maar één keer; behandel het als een
   wachtwoord.

Een token werkt met jouw rechten: Claude ziet en wijzigt precies wat jij in
OGSM.online mag zien en wijzigen.

### Omgevingen instellen

De instellingen van de extensie hebben 10 plekken, elk een paar van:

- **Environment N: host**: de volledige host van de omgeving, bijvoorbeeld
  `klant.ogsm.online`, of een eigen server zoals `example.ogsm.online`.
- **Environment N: personal API token**: het token voor die host. Claude
  Desktop bewaart het veilig als gevoelige waarde en toont het gemaskeerd.

Vul zoveel plekken in als je nodig hebt en laat de rest leeg. Plek 1 is verplicht.

### Beveiliging

- **Jij kiest de omgeving, in elk gesprek.** Voordat Claude iets doet, toont
  het de ingestelde omgevingen (alleen hostnamen, nooit tokens) en vraagt het
  in welke omgeving je wilt werken, ook als er maar één is ingesteld. De
  extensie dwingt dat zelf af, niet alleen via instructies aan Claude:
  - elke tool behalve `list_environments` en `select_environment` weigert
    totdat er een omgeving is gekozen;
  - `select_environment` geeft een willekeurige `environment_session` die aan
    de gekozen omgeving vastzit en die elke andere tool moet meegeven. Die
    bestaat alleen in het gesprek waarin je de keuze maakte, dus in een nieuw
    gesprek kies je opnieuw; na 12 uur zonder gebruik vervalt de keuze;
  - wisselen van omgeving vraagt een nieuwe, expliciete `select_environment`;
  - de extensie kiest nooit zelf een omgeving;
  - als Claude Desktop MCP-*elicitation* ondersteunt, toont de extensie je ook
    een keuzelijst met de ingestelde omgevingen (zonder standaardwaarde) en
    gebruikt jouw keuze, niet die van Claude.
- **Lezen tegenover wijzigen.** Gebruik een token met *Alleen lezen* als Claude
  alleen hoeft op te zoeken. Een wijziging met zo'n token weigert OGSM.online
  met `read_only_token`, en Claude laat je dat weten.
- **Tokens blijven op je computer.** Ze gaan alleen, als
  `Authorization: Bearer …`, naar `https://<host>/api/v3/…` van de omgeving
  waar ze bij horen, en staan nooit in de uitvoer van een tool.

Zie de Engelse tekst hierboven voor de lijst met tools, ontwikkelen en releasen.

## License

[ISC](LICENSE)
